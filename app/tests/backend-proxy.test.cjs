const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
// Origin rules for /api/backend?coding|chrome|desktop run on the app server before forwarding to Convex.
async function withConvexSite(fn){
 const seen=[];const site=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;seen.push({url:req.url,secret:req.headers['x-branch-proxy'],body});res.writeHead(200,{'Content-Type':'application/json'});res.end('{"value":{"boardTitle":"Board"}}');});
 await new Promise(r=>site.listen(0,'127.0.0.1',r));
 process.env.CONVEX_SITE_URL='http://127.0.0.1:'+site.address().port;process.env.BRANCH_PROXY_SECRET='proxy-test-secret';
 try{await fn(seen);}finally{site.close();delete process.env.CONVEX_SITE_URL;delete process.env.BRANCH_PROXY_SECRET;}
}
function call(url,{method='POST',headers={},body='{}',remote='127.0.0.1'}={}){
 const {route}=require('../../collaboration/backend-proxy.cjs');
 return new Promise((resolve,reject)=>{
  const out={status:0,headers:{},body:''};
  const res={headersSent:false,writableEnded:false,setHeader(k,v){out.headers[k.toLowerCase()]=v;},writeHead(status,h={}){out.status=status;for(const [k,v] of Object.entries(h))out.headers[k.toLowerCase()]=v;this.headersSent=true;},end(data){out.body=data?String(data):'';this.writableEnded=true;resolve(out);}};
  const req={method,headers:{'content-type':'application/json',...headers},body:Buffer.from(body),socket:{remoteAddress:remote}};
  route(req,res,new URL(url)).catch(reject);
 });
}
test('forwards allowed sync requests with the proxy secret',async()=>{await withConvexSite(async seen=>{
 const desktop=await call('http://localhost:4390/api/backend?desktop=status',{body:'{"key":"k"}'});
 assert.equal(desktop.status,200);assert.equal(seen.at(-1).url,'/branch/sync?op=status&source=desktop');assert.equal(seen.at(-1).secret,'proxy-test-secret');
 const chrome=await call('https://joinbranch.dev/api/backend?chrome=save',{headers:{origin:'chrome-extension://lgbhkehiipjkjhpdkkmakodccahllneh'},body:'{"key":"k"}'});
 assert.equal(chrome.status,200);assert.equal(chrome.headers['access-control-allow-origin'],'chrome-extension://lgbhkehiipjkjhpdkkmakodccahllneh');
 assert.equal(seen.at(-1).url,'/branch/sync?op=save');
});});
test('rejects cross-site, remote desktop, mixed and unknown sync requests before forwarding',async()=>{await withConvexSite(async seen=>{
 const cases=[
  ['https://joinbranch.dev/api/backend?chrome=status',{headers:{origin:'https://evil.example'}}],
  ['https://joinbranch.dev/api/backend?chrome=status',{headers:{'sec-fetch-site':'cross-site'}}],
  ['http://localhost:4390/api/backend?desktop=status',{remote:'10.0.0.5'}],
  ['http://localhost:4390/api/backend?desktop=status',{headers:{origin:'http://localhost:4390'}}],
  ['https://joinbranch.dev/api/backend?chrome=status&desktop=status',{}],
  ['https://example.com/api/backend?chrome=status',{}],
 ];
 for(const [url,opts] of cases)assert.equal((await call(url,opts)).status,403,url+' '+JSON.stringify(opts));
 assert.equal((await call('https://joinbranch.dev/api/backend?chrome=delete')).status,400);
 assert.equal((await call('https://joinbranch.dev/api/backend?chrome=status',{method:'GET'})).status,405);
 assert.equal((await call('https://joinbranch.dev/api/backend?chrome=status',{headers:{'content-type':'text/plain'}})).status,415);
 assert.equal(seen.length,0);
});});
test('extension preflight is limited to POST with Content-Type',async()=>{await withConvexSite(async()=>{
 const origin='chrome-extension://lgbhkehiipjkjhpdkkmakodccahllneh';
 const ok=await call('https://joinbranch.dev/api/backend?chrome=save',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type'}});
 assert.equal(ok.status,204);assert.equal(ok.headers['access-control-allow-methods'],'POST');
 const bad=await call('https://joinbranch.dev/api/backend?chrome=save',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'authorization'}});
 assert.equal(bad.status,403);
});});
test('coding requests must come without an Origin and fail closed without configuration',async()=>{
 assert.equal((await call('https://joinbranch.dev/api/backend?coding',{headers:{origin:'https://joinbranch.dev'}})).status,403);
 process.env.BRANCH_PROXY_SECRET='';
 try{assert.equal((await call('https://joinbranch.dev/api/backend?coding',{headers:{authorization:'Bearer x'}})).status,503);}finally{delete process.env.BRANCH_PROXY_SECRET;}
 await withConvexSite(async seen=>{
  const r=await call('https://joinbranch.dev/api/backend?coding',{headers:{authorization:'Bearer branch_abc',accept:'application/json, text/event-stream'}});
  assert.equal(r.status,200);assert.equal(seen.at(-1).url,'/branch/coding');
 });
 assert.equal((await call('https://joinbranch.dev/api/backend?other')).status,410);
});
