const {test}=require('node:test');
const assert=require('node:assert/strict');
const {metadataHTML,renderPNG,servePreview}=require('../social-preview.cjs');
const token='a'.repeat(64),url=new URL('https://branch.example/app?join='+token);
const board={title:'Research < & "ideas"',count:2,nodes:[{key:'a',title:'Question',body:'A real saved note',x:100,y:100,width:380,height:240},{key:'b',title:'Answer',x:650,y:150,width:380,height:260,connections:['a']}]};
test('share metadata escapes board names and provides an absolute PNG image URL',()=>{
 const html=metadataHTML('<head><title>Old</title></head>',board,url);
 assert.match(html,/Research &lt; &amp; &quot;ideas&quot;/);assert.match(html,/https:\/\/branch.example\/api\/share-image\?join=/);assert.match(html,/summary_large_image/);assert.match(html,/content="1200"/);
 const privateHTML=metadataHTML('<head><title>Old</title></head>',null,new URL('https://branch.example/app?board=private'));
 assert.doesNotMatch(privateHTML,/og:image|Research/);
});
test('board renderer outputs a 1200 by 630 PNG including empty boards',()=>{
 for(const data of [board,{title:'Empty',count:0,nodes:[]}]){const png=renderPNG(data);assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);}
});
test('revoked tokens and board IDs never return private preview data',async()=>{
 const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(s){this.status=s;},end(body){this.body=body;}});
 let calls=0;const lookup=async()=>{calls++;throw Error('Revoked');};
 const image=response();await servePreview({method:'GET'},image,new URL('https://example.com/api/share-image?join='+token),lookup);assert.equal(image.status,404);assert.equal(image.headers['Cache-Control'],'private, no-store');
 const page=response();await servePreview({method:'GET'},page,url,lookup);assert.doesNotMatch(page.body,/og:image|Research/);
 const restricted=response();await servePreview({method:'GET'},restricted,new URL('https://example.com/app?board=private'),lookup);assert.equal(calls,2);
});
