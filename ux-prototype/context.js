/* Directional, immutable context snapshots. Shared by the app and its tests. */
(function(root){
 const copy=value=>JSON.parse(JSON.stringify(value));
 function textOf(node,cutoff){
  if(node.type==='plan')return node.body||'';
  if(node.type==='upload')return node.text||node.title;
  if(node.type==='media')return [node.title,node.credit,node.source,node.transcriptLanguage&&node.transcript?'YouTube captions (spoken content; may contain automatic-caption errors). Language: '+node.transcriptLanguage:'',node.transcript].filter(Boolean).join('\n');
  if(node.type==='web'){const notes=String(node.body||'').trim();return [node.url,notes?`User perspective and notes (written by a board collaborator, not extracted website text):\n${notes}`:''].filter(Boolean).join('\n\n');}
  if(node.type==='thread'){let messages=node.messages||[];const index=cutoff?messages.findIndex(m=>m.id===cutoff):-1;if(index>=0)messages=messages.slice(0,index+1);return messages.map(m=>(m.role==='user'?'You':'AI')+': '+m.text).join('\n\n')}
  return node.query||node.title||'';
 }
 function snapshotNode(node,nodes,{quote='',cutoff=null}={}){
  const lookup=new Map(nodes.map(n=>[n.id,n]));
  function capture(binding,seen){if(seen.has(binding.source))return null;const next=new Set([...seen,binding.source]),source=lookup.get(binding.source);const result=copy(binding);const upstream=Array.isArray(binding.inherited)?binding.inherited:(source?.contexts||[]);result.inherited=upstream.map(c=>capture(c,next)).filter(Boolean);return result}
  const attachment=node.type==='upload'&&!node.text?{kind:node.mime==='application/pdf'?'pdf':/^image\//.test(node.mime)?'image':'unsupported',storageId:node.storageId||'',asset:node.asset||''}:node.type==='media'&&node.mediaType!=='video'&&node.image?{kind:'image',url:node.image}:null;
  const availability=node.type==='media'&&node.mediaType==='video'&&!node.transcript?'YouTube captions are pending; no transcript content is available yet. Send waits for captions.':attachment?.kind==='unsupported'?'File contents unavailable; only metadata is included.':'';
  const point=cutoff?(node.messages||[]).find(m=>m.id===cutoff):null;
  const upstream=point?.context||node.contexts||[];
  return {source:node.id,title:node.title,body:textOf(node,cutoff),revision:node.revision||1,quote,enabled:true,cutoff,...(node.type==='media'&&node.mediaType==='video'?{video:{id:node.videoId,included:!!node.transcript,language:node.transcriptLanguage||'und'}}:{}),...(attachment?{attachment}:{}),...(availability?{availability}:{}),inherited:upstream.map(c=>capture(c,new Set([node.id]))).filter(Boolean)};
 }
 function resolveContext(bindings){const result=[],seen=new Set();
  function visit(c){if(c.enabled!==false)(c.inherited||[]).forEach(visit);const text=c.enabled!==false?c.body||'':'';const attachment=c.enabled!==false&&!c.excerptOnly?c.attachment:null;if(!text&&!c.quote&&!attachment)return;const key=JSON.stringify([c.source,c.revision,c.quote||'',text,attachment]);if(seen.has(key))return;seen.add(key);result.push({source:c.source,title:c.title,revision:c.revision,quote:c.quote||'',text,cutoff:c.cutoff||null,...(attachment?{attachment:copy(attachment)}:{}),...(c.enabled!==false&&!c.excerptOnly&&c.video?{video:copy(c.video)}:{}),...(c.availability?{availability:c.availability}:{})})}
  bindings.forEach(visit);return result;
 }
 function hasContent(node){if(!node||node.type==='search')return false;if(node.type==='thread')return (node.messages||[]).some(m=>m.text?.trim());if(node.type==='plan')return !!node.body?.trim();if(node.type==='media')return !!(node.source&&(node.image||node.videoId));return !!textOf(node).trim();}
 function canBranch(node,cutoff=null){return hasContent(node)&&(!cutoff||!!node.messages?.find(m=>m.id===cutoff)?.text?.trim());}
 function branchPayload(node,nodes,{quote='',cutoff=null}={}){
  const context=snapshotNode(node,nodes,{quote,cutoff});let draft='';
  if(quote){context.body=quote;context.excerptOnly=true;delete context.attachment;delete context.video;delete context.availability;}
  else if(cutoff){const index=(node.messages||[]).findIndex(m=>m.id===cutoff),message=node.messages?.[index];if(message?.role==='user'){draft=message.text;context.body=textOf({...node,messages:node.messages.slice(0,index)});}}
  return {context,draft};
 }
 const api={textOf,snapshotNode,resolveContext,hasContent,canBranch,branchPayload};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BranchContext=api;
})(typeof globalThis!=='undefined'?globalThis:this);
