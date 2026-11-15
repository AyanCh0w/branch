// Fast, transient interaction channel. Durable state still arrives through Supabase.
export function openLiveBoard({client,scope,tabId,WebSocketClass=WebSocket}){
 const listeners=new Set(),states=new Set();let socket,closed=false,ready=false,retry,renew,handshake,attempt=0;
 const emit=message=>{for(const listener of listeners)listener(message);};
 const status=value=>{if(ready===value)return;ready=value;for(const listener of states)listener(value);};
 const auth=()=>{if(socket?.readyState===1)socket.send(JSON.stringify({type:'auth',accessToken:client.session?.access_token||'',token:scope.token||'',tabId,visible:!document.hidden}));};
 function connect(){
  clearTimeout(retry);if(closed||document.hidden)return;
  const url=new URL('/api/live',location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('board',scope.boardId);
  const current=new WebSocketClass(url.href);socket=current;
  current.onopen=()=>{if(socket===current){auth();handshake=setTimeout(()=>current.close(),10000);}};
  current.onmessage=event=>{
   if(socket!==current)return;let message;try{message=JSON.parse(event.data);}catch{return;}
   if(message.type==='ready'){clearTimeout(handshake);attempt=0;status(true);clearInterval(renew);renew=setInterval(auth,25000);}
   else if(ready)emit(message);
  };
  current.onclose=()=>{if(socket!==current)return;clearTimeout(handshake);clearInterval(renew);status(false);emit({type:'reset'});if(!closed&&!document.hidden)retry=setTimeout(connect,Math.min(10000,500*2**Math.min(attempt++,4))+Math.random()*200);};
  current.onerror=()=>current.close();
 }
 function resume(){
  if(closed)return;
  api.send({type:'visibility',visible:!document.hidden});
  if(document.hidden){api.send({type:'cursor',position:null});api.send({type:'clear'});return;}
  if(!socket||socket.readyState>1)connect();else if(socket.readyState===1)auth();
 }
 const api={
  get ready(){return ready;},
  send(message){if(!ready||socket?.readyState!==1||socket.bufferedAmount>131072)return false;socket.send(JSON.stringify(message));return true;},
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  onStatus(fn){states.add(fn);fn(ready);return()=>states.delete(fn);},
  close(){closed=true;clearTimeout(retry);clearTimeout(handshake);clearInterval(renew);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);api.send({type:'cursor',position:null});socket?.close();status(false);listeners.clear();states.clear();}
 };
 document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);connect();return api;
}

// Display provisional typing without ever inserting unacknowledged remote edits into
// the canonical Yjs document. A rejected/late edit cannot revive a sent prompt.
export function liveTextPreviews({host,docs,tabId,isEditing,now=Date.now}){
 const previews=new Map();
 function render(){
  const nodes=new Map(host.getState().nodes.map(n=>[n.id,n])),paint=new Map();
  for(const [key,p]of previews){
   const node=nodes.get(p.nodeKey),doc=docs.get(p.nodeKey);
   if(!node||!doc||p.expiresAt<=now()||p.epoch!==doc.epoch||node[p.field]===p.text||isEditing(p.nodeKey,p.field)){
    previews.delete(key);if(node&&!isEditing(p.nodeKey,p.field))paint.set(p.nodeKey,{...node,...paint.get(p.nodeKey)});continue;
   }
   paint.set(p.nodeKey,{...node,...paint.get(p.nodeKey),[p.field]:p.text});
  }
  for(const node of paint.values())host.refreshText(node);
 }
 function clear(){const keys=new Set([...previews.values()].map(p=>p.nodeKey));previews.clear();for(const node of host.getState().nodes)if(keys.has(node.id))host.refreshText(node);}
 function receive(p){
  if(p.type==='reset'){clear();return;}
  if(p.type==='leave'||p.type==='clear'){for(const value of previews.values())if(value.tabId===p.tabId&&value.userId===p.userId)value.expiresAt=0;render();return;}
  if(p.type!=='text'||p.tabId===tabId)return;
  const item=docs.get(p.nodeKey);if(!item||item.epoch!==p.epoch||isEditing(p.nodeKey,p.field))return;
  previews.set(p.nodeKey+':'+p.field,{...p,expiresAt:now()+4000});render();
 }
 return {receive,render,clear};
}
