const {test}=require('node:test');
const assert=require('node:assert/strict');
const {prepareLocalFiles}=require('../../collaboration/prepare-files.cjs');
const source={title:'Pitch',source:'pdf',body:'Frozen text',attachment:{kind:'pdf',asset:'original'}};
test('legacy inherited file uploads exact bytes once and preserves frozen snapshots',async()=>{
 const contexts=[{body:'Parent',inherited:[source,source]}];const before=JSON.stringify(contexts);let uploads=0;
 const cache=new Map();const options={cache,read:async asset=>{assert.equal(asset,'original');return 'bytes';},upload:async file=>{assert.equal(file,'bytes');uploads++;return 'stored';}};
 const nodes=[{id:'pdf',asset:'replacement',storageId:'newer'}];
 assert.deepEqual(await prepareLocalFiles(contexts,nodes,options),[{asset:'original',storageId:'stored'}]);
 await prepareLocalFiles(contexts,nodes,options);assert.equal(uploads,1);assert.equal(JSON.stringify(contexts),before);
});
test('reuse uploaded matching asset, skip disabled and excerpt attachments',async()=>{
 const options={read:()=>{throw Error('Unexpected read');},upload:()=>{throw Error('Unexpected upload');}};
 assert.deepEqual(await prepareLocalFiles([source],[{asset:'original',storageId:'stored'}],options),[{asset:'original',storageId:'stored'}]);
 assert.deepEqual(await prepareLocalFiles([{...source,enabled:false},{...source,excerptOnly:true}],[],options),[]);
});
test('missing local file gives recovery instruction and does not upload',async()=>{
 await assert.rejects(prepareLocalFiles([source],[],{read:async()=>null,upload:()=>{throw Error('Unexpected upload');}}),/Reattach it and refresh this context reference, or detach/);
});
