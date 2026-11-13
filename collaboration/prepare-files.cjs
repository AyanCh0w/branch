const {resolveContext}=require('../app/context.js');

// Upload only the bytes named by the frozen snapshot. A newer source may have
// different content, so its storage ID is reusable only for the same asset.
async function prepareLocalFiles(contexts,nodes,{read,upload,cache=new Map()}) {
 const files=new Map();
 for(const source of resolveContext(contexts)) {
  const a=source.attachment;
  if(!a||a.storageId||!a.asset||files.has(a.asset))continue;
  if(a.kind==='unsupported')throw Error('Unsupported file: '+source.title+'. Use a PDF, image, or text file.');
  let storageId=cache.get(a.asset)||nodes.find(n=>n.asset===a.asset&&n.storageId)?.storageId;
  if(!storageId){
   const file=await read(a.asset);
   if(!file)throw Error('The file “'+source.title+'” is unavailable on this device. Reattach it and refresh this context reference, or detach the reference before sending.');
   storageId=await upload(file);
  }
  cache.set(a.asset,storageId);
  files.set(a.asset,{asset:a.asset,storageId});
 }
 return [...files.values()];
}
module.exports={prepareLocalFiles};
