import {convexTest} from 'convex-test';
import {it,expect,vi,afterEach} from 'vitest';
import {registerCore,sessionIdentity} from '@convex-dev/auth/test';
import {registerPassword} from '@convex-dev/auth/components/password/test';
import {registerUsername} from '@convex-dev/auth/components/username/test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.ts');
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
async function setup(){
 vi.stubEnv('CONVEX_CLOUD_URL','https://test.convex.cloud');
 const t=convexTest(schema,modules);registerCore(t);registerPassword(t);registerUsername(t);
 const account=async(username:string)=>{const r=await t.mutation(api.auth.signUpWithUsernamePassword,{username,password:'unique-chatgpt-test-password-9384'});if(r.status!=='complete')throw Error();const client=t.withIdentity(sessionIdentity(r.tokens));const me=await client.query(api.accounts.me,{});return {client,id:me!.id};};
 const alice=await account('alice'),bob=await account('bob');return {t,alice,bob};
}
async function connect(t:any,userId:any){
 await t.mutation(internal.chatgpt.begin,{userId,stateHash:'state',browserHash:'browser',ciphertext:'encrypted transaction',expiresAt:Date.now()+60000});
 const tx=await t.mutation(internal.chatgpt.consume,{stateHash:'state',browserHash:'browser'});
 await t.mutation(internal.chatgpt.connect,{transactionId:tx._id,userId,ciphertext:'encrypted tokens',subject:'subject',clientId:'oaiapp_test',label:'Alice ChatGPT',models:[{slug:'account-model',name:'Account model'},{slug:'other-model',name:'Other model'}],expiresAt:Date.now()+3600000});
 return t.query(internal.chatgpt.get,{userId});
}
it('isolates credentials and model choices by signed-in user',async()=>{
 const {t,alice,bob}=await setup();await connect(t,alice.id);
 const status=await alice.client.query(api.chatgpt.status,{});expect(status.connected).toBe(true);expect(JSON.stringify(status)).not.toContain('encrypted');expect(status.selectedModel).toBe('account-model');
 expect((await bob.client.query(api.chatgpt.status,{})).connected).toBe(false);
 await expect(bob.client.mutation(api.chatgpt.chooseModel,{model:'account-model'})).rejects.toThrow();
 await expect(alice.client.mutation(api.chatgpt.chooseModel,{model:'invented-model'})).rejects.toThrow();
 await alice.client.mutation(api.chatgpt.chooseModel,{model:'other-model'});expect((await alice.client.query(api.chatgpt.status,{})).selectedModel).toBe('other-model');
 await expect(alice.client.action(api.chatgptActions.forServer,{boardId:await alice.client.mutation(api.library.create,{title:'Test'}),token:'',secret:'wrong'})).rejects.toThrow(/denied/);
});
it('consumes OAuth state once, binds the browser, and prevents disconnect racing a callback',async()=>{
 const {t,alice}=await setup();await t.mutation(internal.chatgpt.begin,{userId:alice.id,stateHash:'state',browserHash:'browser',ciphertext:'encrypted',expiresAt:Date.now()+60000});
 await expect(t.mutation(internal.chatgpt.consume,{stateHash:'state',browserHash:'attacker'})).rejects.toThrow();
 const tx=await t.mutation(internal.chatgpt.consume,{stateHash:'state',browserHash:'browser'});
 await expect(t.mutation(internal.chatgpt.consume,{stateHash:'state',browserHash:'browser'})).rejects.toThrow();
 await t.mutation(internal.chatgpt.remove,{userId:alice.id});
 await expect(t.mutation(internal.chatgpt.connect,{transactionId:tx._id,userId:alice.id,ciphertext:'secret',subject:'s',clientId:'oaiapp_test',label:'Test',models:[],expiresAt:Date.now()+10000})).rejects.toThrow();
});
it('serializes rotating refresh tokens and never resurrects disconnected credentials',async()=>{
 const {t,alice}=await setup(),row=await connect(t,alice.id);
 expect(await t.mutation(internal.chatgpt.lock,{id:row._id,revision:0,lease:'first'})).toBe(true);
 expect(await t.mutation(internal.chatgpt.lock,{id:row._id,revision:0,lease:'second'})).toBe(false);
 await expect(t.mutation(internal.chatgpt.renewed,{id:row._id,lease:'second',ciphertext:'bad',expiresAt:1})).rejects.toThrow();
 await t.mutation(internal.chatgpt.remove,{userId:alice.id});
 await expect(t.mutation(internal.chatgpt.renewed,{id:row._id,lease:'first',ciphertext:'new',expiresAt:1})).rejects.toThrow();
 expect(await t.query(internal.chatgpt.get,{userId:alice.id})).toBeNull();
});
it('freezes the sender connection and selected model while keeping owner attribution and send locks',async()=>{
 vi.useFakeTimers();const {t,alice,bob}=await setup();const connection=await connect(t,alice.id);
 const boardId=await bob.client.mutation(api.library.create,{title:'Shared'});
 await bob.client.mutation(api.sharing.addMember,{boardId,username:'alice',role:'editor'});
 await bob.client.mutation(api.boards.patchNodes,{boardId,token:'',changes:[{id:'chat',type:'thread',title:'Chat',draft:'Hello',messages:[],contexts:[],x:0,y:0},{id:'other',type:'thread',title:'Other',draft:'Hello',messages:[],contexts:[],x:0,y:0}].map(node=>({id:node.id,create:node}))});
 const runId=await alice.client.mutation(api.chat.send,{boardId,token:'',nodeKey:'chat',requestId:'one',expectedVersion:0});
 await alice.client.mutation(api.chatgpt.chooseModel,{model:'other-model'});
 const run=await t.query(internal.chat.getRun,{runId});expect(run!.model).toBe('account-model');expect(run!.connectionId).toBe(connection._id);expect(run!.providerUserId).toBe(alice.id);expect(run!.billedUserId).toBe(bob.id);
 const defaultId=await bob.client.mutation(api.chat.send,{boardId,token:'',nodeKey:'other',requestId:'two',expectedVersion:0});const defaultRun=await t.query(internal.chat.getRun,{runId:defaultId});expect(defaultRun!.model).toBe('gpt-5.4-mini');expect(defaultRun!.provider).toBe('default');expect(defaultRun!.connectionId).toBeUndefined();
});

it('verifies OAuth identity and consent before storing a connection, then renews and revokes it',async()=>{
 const {t,alice}=await setup();
 const {generateKeyPair,exportJWK,SignJWT}=await import('jose');
 const {hash,seal}=await import('./chatgpt/protocol.cjs');
 const {publicKey,privateKey}=await generateKeyPair('RS256');const jwk={...await exportJWK(publicKey),kid:'test-key',alg:'RS256',use:'sig'};
 vi.stubEnv('CHATGPT_HOSTED_APPROVED','true');vi.stubEnv('CHATGPT_CLIENT_ID','oaiapp_test');vi.stubEnv('CHATGPT_REDIRECT_URI','https://branch.example/api/chatgpt?action=callback');vi.stubEnv('CHATGPT_ENCRYPTION_KEY','ab'.repeat(32));
 let nonce='',wrongNonce=true,refreshes=0,revoked=false;
 const mock=vi.spyOn(globalThis,'fetch').mockImplementation(async(input:any,options:any)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url.endsWith('openid-configuration'))return Response.json({issuer:'https://auth.openai.com',authorization_endpoint:'https://auth.openai.com/api/accounts/authorize',token_endpoint:'https://auth.openai.com/api/accounts/oauth/token',jwks_uri:'https://auth.openai.com/.well-known/jwks.json',revocation_endpoint:'https://auth.openai.com/revoke'});
  if(url.endsWith('jwks.json'))return Response.json({keys:[jwk]});
  if(url.endsWith('/oauth/token')){
   const form=new URLSearchParams(options.body);const refresh=form.get('grant_type')==='refresh_token';if(refresh)refreshes++;
   const id=await new SignJWT({nonce:wrongNonce?'wrong':nonce,email:'user@example.com'}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer('https://auth.openai.com').setAudience('oaiapp_test').setSubject('verified-subject').setIssuedAt().setExpirationTime('1h').sign(privateKey);
   return Response.json({id_token:id,access_token:refresh?'renewed-test-token':'test-access-token',refresh_token:'test-refresh-token',token_type:'Bearer',expires_in:3600,scope:'openid resource.invoke chatgpt.tokens.use.direct'});
  }
  if(url.endsWith('/models'))return Response.json({models:[{slug:'account-model',display_name:'Account model',visibility:'list'}]});
  if(url.endsWith('/revoke')){revoked=true;return new Response(null,{status:200});}
  throw Error('Unexpected network request');
 });
 try{
  let start=await alice.client.action(api.chatgptActions.start,{browserHash:hash('browser-secret')});let url=new URL(start.url);nonce=url.searchParams.get('nonce')!;
  await expect(t.action(api.chatgptActions.finish,{state:url.searchParams.get('state')!,browserSecret:'browser-secret',code:'test-code'})).rejects.toThrow(/not verified/);
  expect((await alice.client.query(api.chatgpt.status,{})).connected).toBe(false);
  wrongNonce=false;start=await alice.client.action(api.chatgptActions.start,{browserHash:hash('browser-secret')});url=new URL(start.url);nonce=url.searchParams.get('nonce')!;
  await t.action(api.chatgptActions.finish,{state:url.searchParams.get('state')!,browserSecret:'browser-secret',code:'test-code'});
  const row=await t.query(internal.chatgpt.get,{userId:alice.id});expect(row.subject).toBe('verified-subject');expect(JSON.stringify(row)).not.toContain('test-access-token');
  await t.run(ctx=>ctx.db.patch(row._id,{expiresAt:0,ciphertext:seal({accessToken:'expired',refreshToken:'test-refresh-token',expiresAt:0,scopes:['resource.invoke','chatgpt.tokens.use.direct']},'ab'.repeat(32))}));
  const args={userId:alice.id,connectionId:row._id,model:'account-model'};const results=await Promise.all([t.action(internal.chatgptActions.resolve,args),t.action(internal.chatgptActions.resolve,args)]);expect(refreshes).toBe(1);expect(results.every(r=>r.token==='renewed-test-token')).toBe(true);
  expect(await alice.client.action(api.chatgptActions.disconnect,{})).toEqual({revoked:true});expect(revoked).toBe(true);expect((await alice.client.query(api.chatgpt.status,{})).connected).toBe(false);
 }finally{mock.mockRestore();}
});
