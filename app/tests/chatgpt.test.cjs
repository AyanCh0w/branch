const {test}=require('node:test');
const assert=require('node:assert/strict');
const p=require('../../collaboration/chatgpt/protocol.cjs');
const {completedResponse}=require('../../collaboration/chatgpt/requests.cjs');
const config=p.configuration({CHATGPT_HOSTED_APPROVED:'true',CHATGPT_CLIENT_ID:'oaiapp_branch',CHATGPT_REDIRECT_URI:'https://branch.example/api/chatgpt?action=callback',CHATGPT_ENCRYPTION_KEY:'ab'.repeat(32)});
test('hosted sign-in requires approved configuration, unique PKCE and browser-bound state',()=>{
 assert.throws(()=>p.configuration({}));assert.throws(()=>p.transaction(config,'bad'));
 const a=p.transaction(config,p.hash('browser')),b=p.transaction(config,p.hash('browser'),'//attacker.example');
 assert.notEqual(a.state,b.state);assert.notEqual(a.verifier,b.verifier);assert.equal(b.returnPath,'/app');
 const url=new URL(p.authorizeURL(config,{authorization_endpoint:'https://auth.openai.com/api/accounts/authorize'},a));
 assert.equal(url.searchParams.get('client_id'),'oaiapp_branch');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.notEqual(url.searchParams.get('code_challenge'),a.verifier);assert.match(url.searchParams.get('scope'),/chatgpt.tokens.use.direct/);
 const encrypted=p.seal(a,config.secret);assert.ok(!encrypted.includes(a.verifier));assert.deepEqual(p.unseal(encrypted,config.secret),a);assert.throws(()=>p.unseal(encrypted,'cd'.repeat(32)));
});
test('identity consent alone never enables plan usage and catalogs contain only offered models',()=>{
 assert.throws(()=>p.tokenSet({access_token:'test',token_type:'Bearer',expires_in:3600,scope:'openid email'}),/not granted/);
 assert.deepEqual(p.catalog({models:[{slug:'one',display_name:'One',visibility:'list'},{slug:'hidden',display_name:'Hidden',visibility:'hidden'}]}),[{slug:'one',name:'One'}]);
 const previous=p.tokenSet({access_token:'first',refresh_token:'refresh',token_type:'Bearer',expires_in:3600,scope:'resource.invoke chatgpt.tokens.use.direct'});
 assert.equal(p.tokenSet({access_token:'second',token_type:'Bearer',expires_in:3600},previous).refreshToken,'refresh');
});
test('plan requests preserve files and web search, namespace canvas tools, and omit unsupported fields',()=>{
 const input=[{role:'user',content:[{type:'input_file',file_url:'https://example.com/a.pdf'}]}];
 const r=p.planRequest({model:'offered-model',input,tools:[{type:'web_search'},{type:'function',name:'create_node'}],max_output_tokens:100,previous_response_id:'old',store:true,stream:false});
 assert.deepEqual(r.input,input);assert.equal(r.model,'offered-model');assert.equal(r.max_output_tokens,undefined);assert.equal(r.previous_response_id,undefined);assert.equal(r.stream,true);assert.equal(r.store,false);assert.equal(r.tools[0].type,'web_search');assert.equal(r.tools[1].type,'namespace');
});
test('a partial stream or usage failure never counts as completed inference',async()=>{
 const stream=events=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
 await assert.rejects(completedResponse(stream([{type:'response.output_text.delta',delta:'partial'}])),/ended early/);
 await assert.rejects(completedResponse(stream([{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}])),/plan limit/);
 assert.deepEqual(await completedResponse(stream([{type:'response.completed',response:{output:[]}}])),{output:[]});
});
test('callback requires browser cookie and start rejects cross-site or unauthenticated requests',async()=>{
 const route=require('../../collaboration/chatgpt/routes.cjs');let calls=0;const client={action:async()=>{calls++;throw Error('must not run');}};
 const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);},end(body){this.body=body;}});
 let res=response();await route({method:'GET',headers:{}},res,new URL('https://branch.example/api/chatgpt?action=callback&state=bad&code=bad'),client,{hosted:true});assert.equal(res.status,303);assert.equal(res.headers.Location,'/app?chatgpt=failed');assert.equal(calls,0);
 res=response();await route({method:'POST',headers:{origin:'https://evil.example',authorization:'Bearer test'}},res,new URL('https://branch.example/api/chatgpt?action=start'),client,{hosted:true});assert.equal(res.status,403);assert.equal(calls,0);
});
