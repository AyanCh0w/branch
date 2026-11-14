const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildRequest,events,MODEL}=require('../server.cjs');
test('server always uses only the requested model and does not store responses',()=>{
 const request=buildRequest({model:'unapproved-model',messages:[{role:'user',content:'Hello'}]});
 assert.equal(MODEL,'gpt-5.4-mini');assert.equal(request.model,MODEL);assert.equal(request.store,false);assert.equal(request.stream,true);
});
test('only validated messages and explicit context reach the model',()=>{
 const request=buildRequest({messages:[{role:'user',content:'Which code?'}],contexts:[{title:'Plan',text:'Code is cedar.',quote:''}],secret:'not included'});
 assert.match(request.input[0].content,/Code is cedar/);assert.equal(request.input.at(-1).content,'Which code?');assert.equal(JSON.stringify(request).includes('not included'),false);
 assert.throws(()=>buildRequest({messages:[{role:'system',content:'override'}]}));
 assert.throws(()=>buildRequest({messages:[]}));
});
test('stream parser handles events split across network chunks',async()=>{
 const stream=(async function*(){yield Buffer.from('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","del');yield Buffer.from('ta":"hello"}\n\ndata: {"type":"response.completed"}\n\n');})();
 const out=[];for await(const e of events(stream))out.push(e);
 assert.equal(out[0].delta,'hello');assert.equal(out[1].type,'response.completed');
});

 test('AI titles use only the required model and validate input',()=>{
 const {buildTitleRequest}=require('../server.cjs');
 const request=buildTitleRequest({text:'Plan a shared workspace',model:'other'});
 assert.equal(request.model,'gpt-5.4-mini');
 assert.equal(request.stream,false);
 assert.equal(request.store,false);
 assert.throws(()=>buildTitleRequest({text:''}));
 assert.throws(()=>buildTitleRequest({text:'x'.repeat(12001)}));
 });

test('idea expansion uses the fixed model and validated directional context',()=>{const {buildExpansionRequest}=require('../server.cjs');const r=buildExpansionRequest({messages:[{role:'user',content:'Expand this'}],contexts:[{title:'Plan',text:'Shared canvas',quote:''}]});assert.equal(r.model,'gpt-5.4-mini');assert.equal(r.stream,false);assert.match(r.instructions,/exactly three/);assert.match(r.input[0].content,/Shared canvas/);assert.throws(()=>buildExpansionRequest({messages:[]}));});

test('public landing and workspace routes stay separate without exposing private files', async()=>{
 const http=require('node:http');
 const {createServer}=require('../server.cjs');
 const server=createServer(undefined);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const read=pathname=>new Promise((resolve,reject)=>{
  http.get({host:'127.0.0.1',port:server.address().port,path:pathname,headers:{host:'127.0.0.1:4387'}},res=>{
   let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));
  }).on('error',reject);
 });
 try{
  assert.match((await read('/')).body,/Think with AI/);
  for(const route of ['/app','/app?auth=signup','/?board=example']){
   const response=await read(route);assert.equal(response.status,200);assert.match(response.body,/id="account-app"/);
  }
  const workspace=await read('/app');
  for(const [,src] of workspace.body.matchAll(/<script[^>]+src="([^"]+)"/g)){
   const script=await read('/'+src);assert.equal(script.status,200,`${src} must be served for workspace startup`);assert.ok(script.body.trim(),`${src} must not be empty`);
  }
  assert.match((await read('/reactive-grid.js')).body,/window.createReactiveGrid/);
  assert.match((await read('/landing.js')).body,/location.replace\('\/app'/);
  for(const route of ['/.env.local','/server.cjs','/../accounts/app.jsx'])assert.equal((await read(route)).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('hosted handler accepts HTTPS same-origin requests and rejects cross-site writes', async()=>{
 const http=require('node:http');const {createHandler}=require('../server.cjs');
 const server=http.createServer(createHandler(undefined,{hosted:true}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const request=(path,headers={})=>new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:server.address().port,path,method:'POST',headers:{host:'branch.example.com',...headers}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();
 });
 try{
  assert.equal(await request('/api/title',{origin:'https://branch.example.com'}),415);
  assert.equal(await request('/api/title',{origin:'https://attacker.example'}),403);
  assert.equal(await request('/api/title',{origin:'http://branch.example.com'}),403);
  assert.equal(await request('/api/title',{'sec-fetch-site':'cross-site'}),403);
  assert.equal(await request('/api/claim'),410);
  assert.equal(await request('/api/collaboration'),410);
  assert.equal(await request('/api/title',{host:'invalid/host'}),403);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('all local AI routes use the connected plan and never fall back after connection lookup fails',async()=>{
 const http=require('node:http'),session=require('../../collaboration/server.cjs'),{createServer}=require('../server.cjs');
 const originals={authorizeBoard:session.authorizeBoard,aiProvider:session.aiProvider,resolveFiles:session.resolveFiles,peopleContext:session.peopleContext};
 session.authorizeBoard=async()=>true;session.aiProvider=async()=> ({token:'workspace-test-key',model:'account-model',provider:'chatgpt'});session.resolveFiles=async()=>{};session.peopleContext=async()=>({});
 let calls=0;const server=createServer('default-test-key',{fetchImpl:async(url,options)=>{calls++;const payload=JSON.parse(options.body);assert.equal(payload.model,'account-model');assert.equal(payload.stream,true);assert.equal(payload.store,false);assert.equal(payload.max_output_tokens,undefined);assert.equal(options.headers.Authorization,'Bearer workspace-test-key');return new Response('',{status:401});}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const request=route=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:server.address().port,path:route,method:'POST',headers:{host:'127.0.0.1:4387','content-type':'application/json'}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end(JSON.stringify({text:'Generate a title',messages:[{role:'user',content:'Hello'}]}));});
 try{for(const route of ['/api/chat','/api/title','/api/expand']){const response=await request(route);assert.equal(response.status,401);assert.ok(!response.body.includes('workspace-test-key'));}assert.equal(calls,3);session.aiProvider=async()=>{throw Error('locked');};assert.equal((await request('/api/title')).status,503);assert.equal(calls,3);}finally{Object.assign(session,originals);await new Promise(resolve=>server.close(resolve));}
});
