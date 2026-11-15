// Ported from backend/tests/sync-http.test.ts. Origin and CORS checks for
// ?chrome=/?desktop= stay in the app server; Convex's /branch/sync only accepts
// requests the app server forwarded with the shared proxy secret.
import {convexTest} from 'convex-test';
import {it,expect,vi,afterEach} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {registerCore,sessionIdentity} from '@convex-dev/auth/test';
import {registerPassword} from '@convex-dev/auth/components/password/test';
import {registerUsername} from '@convex-dev/auth/components/username/test';
import schema from '../convex/schema';
import {api} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.ts');
afterEach(()=>{vi.unstubAllEnvs();});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

async function setup(){
 vi.stubEnv('CONVEX_CLOUD_URL','https://test.convex.cloud');
 vi.stubEnv('BRANCH_PROXY_SECRET','proxy-secret');
 const t=convexTest(schema,modules);registerCore(t);registerPassword(t);registerUsername(t);
 const r=await t.mutation(api.auth.signUpWithUsernamePassword,{username:'sync-owner',password:'unique-sync-http-test-password-7731'});if(r.status!=='complete')throw Error();
 const owner=t.withIdentity(sessionIdentity(r.tokens));
 const boardId=await owner.mutation(api.library.create,{title:'Test'});
 const sync=(query:string,body:any,headers:Record<string,string>={'x-branch-proxy':'proxy-secret'})=>t.fetch('/branch/sync?'+query,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 return {t,owner,boardId,sync};
}

it('rejects requests without the app server’s proxy secret',async()=>{
 const {owner,boardId,sync}=await setup();
 const {key}=await owner.mutation(api.chatgptBrowser.connect,{boardId,conversationId:hash('chrome:chat')});
 for(const headers of [{},{'x-branch-proxy':'wrong'},{'x-branch-proxy':''}] as Record<string,string>[]){
  const r=await sync('op=status',{key},headers);expect(r.status).toBe(403);expect(r.headers.get('Cache-Control')).toBe('no-store');
 }
 // Without a configured secret nothing is accepted, even a request with an empty header.
 vi.stubEnv('BRANCH_PROXY_SECRET','');
 expect((await sync('op=status',{key},{'x-branch-proxy':''})).status).toBe(403);
});

it('hosted desktop status uses the scoped capability, not ambient account access',async()=>{
 const {owner,boardId,sync}=await setup();
 const key=`branch_desktop_${Date.now()+60_000}_${'5'.repeat(64)}`;
 await owner.mutation(api.chatgptBrowser.connectDesktop,{boardId,conversationId:hash('desktop chat'),keyHash:hash(key)});
 const r=await sync('op=status&source=desktop',{key});expect(r.status).toBe(200);
 expect(await r.json()).toEqual({value:{boardTitle:'Test',boardId}});
 // The same key is not a Chrome capability.
 expect((await sync('op=status',{key})).status).toBe(401);
 const chrome=await owner.mutation(api.chatgptBrowser.connect,{boardId,conversationId:hash('chrome:chat')});
 expect(await (await sync('op=status',{key:chrome.key})).json()).toEqual({value:{boardTitle:'Test'}});
});

it('saves replies and rejects unknown operations',async()=>{
 const {owner,boardId,sync}=await setup();
 const {key}=await owner.mutation(api.chatgptBrowser.connect,{boardId,conversationId:hash('chrome:chat')});
 const r=await sync('op=save',{key,updateId:randomUUID(),title:'Reply',result:'Synced answer'});
 expect(r.status).toBe(200);expect((await r.json()).value).toMatchObject({boardTitle:'Test',cardId:expect.stringMatching(/^chatgpt-/)});
 expect((await sync('op=delete',{key})).status).toBe(400);
 expect((await sync('op=save',{key,updateId:'not-a-uuid',title:'Reply',result:'x'})).status).toBe(400);
});

it('revoked capability returns disconnected instead of success',async()=>{
 const {owner,boardId,sync}=await setup();
 const {key}=await owner.mutation(api.chatgptBrowser.connect,{boardId,conversationId:hash('chrome:chat')});
 expect((await sync('op=stop',{key})).status).toBe(200);
 const r=await sync('op=save',{key,updateId:randomUUID(),title:'Reply',result:'Late answer'});
 expect(r.status).toBe(401);expect(await r.json()).toEqual({error:'chrome_sync_disconnected'});
 expect((await sync('op=status',{key:'branch_chrome_'+'0'.repeat(64)})).status).toBe(401);
});
