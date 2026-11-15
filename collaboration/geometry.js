// Provisional geometry never changes canonical state or creates a database write.
export function geometryPreviews({host,tabId,now=Date.now}){
 const previews=new Map();
 function render(){
  const nodes=new Map(host.getState().nodes.map(n=>[n.id,n]));
  for(const [id,p]of previews){
   const node=nodes.get(id);
   if(!node||p.expiresAt<=now()||host.isManipulating?.(id)||Object.entries(p.patch).every(([key,value])=>node[key]===value)){
    previews.delete(id);if(node)host.previewGeometry?.(id,{});continue;
   }
   host.previewGeometry?.(id,p.patch);
  }
 }
 function clear(){for(const id of previews.keys())host.previewGeometry?.(id,{});previews.clear();}
 function receive(message){
  if(message.type==='reset'){clear();return;}
  if(message.type==='leave'||message.type==='clear'){for(const p of previews.values())if(p.tabId===message.tabId&&p.userId===message.userId)p.expiresAt=0;render();return;}
  if(message.type!=='geometry'||message.tabId===tabId)return;
  for(const {id,...patch}of message.nodes)previews.set(id,{patch,userId:message.userId,tabId:message.tabId,expiresAt:now()+4000});
  render();
 }
 return {receive,render,clear};
}

export function geometryPublisher({send,getNodes}){
 let ids=[],timer=null,heartbeat=null;
 function emit(){
  clearTimeout(timer);timer=null;
  const nodes=getNodes().filter(n=>ids.includes(n.id)).slice(0,64).map(n=>({id:n.id,x:n.x,y:n.y,...(Number.isFinite(n.width)?{width:n.width}:{}),...(Number.isFinite(n.minHeight)?{minHeight:n.minHeight}:{})}));
  if(nodes.length)send({type:'geometry',nodes});
 }
 return {
  publish(nodes){ids=nodes.map(n=>n.id);if(timer===null)timer=setTimeout(emit,33);if(!heartbeat)heartbeat=setInterval(emit,1000);},
  finish(){clearInterval(heartbeat);heartbeat=null;emit();ids=[];},
  close(){clearTimeout(timer);clearInterval(heartbeat);timer=heartbeat=null;ids=[];}
 };
}
