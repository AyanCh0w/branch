const test=require('node:test'),assert=require('node:assert/strict');
const {checkEmbed,blockedByHeaders,publicIPv4}=require('../embed-check.cjs');
const target=new URL('https://example.com'),parent=new URL('https://board.example');
test('framing headers reject blocked previews and respect CSP precedence',()=>{
 for(const value of ['DENY','SAMEORIGIN'])assert.equal(blockedByHeaders({'x-frame-options':value},target,parent),true);
 assert.equal(blockedByHeaders({'x-frame-options':'SAMEORIGIN'},target,target),false);
 for(const value of ["frame-ancestors 'none'","frame-ancestors 'self'",'frame-ancestors https://elsewhere.example'])assert.equal(blockedByHeaders({'content-security-policy':value},target,parent),true);
 assert.equal(blockedByHeaders({'content-security-policy':"frame-ancestors https://board.example",'x-frame-options':'DENY'},target,parent),false);
 assert.equal(blockedByHeaders({'content-security-policy':"frame-ancestors *, frame-ancestors 'none'"},target,parent),true);
 assert.equal(blockedByHeaders({'content-security-policy-report-only':"frame-ancestors 'none'"},target,parent),false);
 assert.equal(blockedByHeaders({'content-security-policy':"frame-ancestors https://*.example"},target,parent),false);
});
test('preview probes follow redirects and leave inconclusive results alone',async()=>{
 const seen=[];const request=async url=>{seen.push(url.href);return seen.length===1?{status:302,headers:{location:'https://final.example/path'}}:{status:200,headers:{'x-frame-options':'DENY'}};};
 assert.deepEqual(await checkEmbed(target.href,parent.origin,{request}),{status:'blocked'});assert.equal(seen[1],'https://final.example/path');
 for(const [status,expected]of [[200,'allowed'],[403,'unknown'],[404,'unavailable'],[503,'unavailable']])assert.equal((await checkEmbed(target.href,parent.origin,{request:async()=>({status,headers:{}})})).status,expected);
 assert.equal((await checkEmbed(target.href,parent.origin,{request:async()=>{throw Error('timeout');}})).status,'unknown');
});
test('probes exclude private, loopback, metadata and non-IPv4 addresses',()=>{
 for(const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(publicIPv4(address),false,address);
 assert.equal(publicIPv4('93.184.216.34'),true);
});
test('Worker preview transport checks public destinations and never auto-follows redirects',async()=>{
 const {workerRequestHeaders}=require('../embed-check.cjs');let calls=0;
 const fetchImpl=async(url,options)=>{calls++;assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,undefined);return new Response('',{status:302,headers:{location:'http://127.0.0.1/private'}})};
 const request=(url,signal)=>workerRequestHeaders(url,signal,{resolve:async()=>['93.184.216.34'],fetchImpl});
 assert.equal((await checkEmbed('https://example.com','https://board.example',{request})).status,'unknown');assert.equal(calls,1);
 for(const host of ['127.0.0.1','[::1]','localhost','a.localhost','169.254.169.254'])await assert.rejects(workerRequestHeaders(new URL('http://'+host),AbortSignal.timeout(1000),{fetchImpl}),/Private/);
 await assert.rejects(workerRequestHeaders(new URL('https://mixed.example'),AbortSignal.timeout(1000),{resolve:async()=>['93.184.216.34','10.0.0.1'],fetchImpl}),/Private/);
 assert.equal(calls,1);
 const allowed=await workerRequestHeaders(new URL('https://example.com'),AbortSignal.timeout(1000),{resolve:async()=>['93.184.216.34'],fetchImpl:async()=>new Response('discard',{headers:{'x-frame-options':'DENY'}})});assert.equal(allowed.headers['x-frame-options'],'DENY');
});
