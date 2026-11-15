// Transient interaction relay. Supabase remains the only durable board store.
// No token, prompt history or board document is kept in this object.
export class LiveRoomCore {
 paused:string|null=null;
 generation=0;
 constructor(public state:any,public authorize:(boardId:string,message:any)=>Promise<any>,public transactionStatus:(xid:string)=>Promise<string|null>){
  state.blockConcurrencyWhile(async()=>{const saved=await state.storage.get('paused');if(this.generation===0)this.paused=saved||null;});
 }
 async pause(xid:string){
  if(!/^\d+$/.test(xid))throw Error('Invalid transaction');
  this.generation++;this.paused=xid;
  // Stop delivery before acknowledging the pre-commit access barrier.
  for(const socket of this.state.getWebSockets())socket.close(4001,'Board permissions changed');
  await this.state.storage.put('paused',xid);
 }
 async available(){
  if(!this.paused)return true;
  const xid=this.paused,generation=this.generation;
  const status=await this.transactionStatus(xid);
  if(generation!==this.generation||this.paused!==xid)return false;
  // In-progress/unknown transactions fail closed, including a crashed API request.
  if(status!=='committed'&&status!=='aborted')return false;
  this.paused=null;await this.state.storage.delete('paused');return generation===this.generation;
 }
 accept(socket:any,boardId:string){
  this.state.acceptWebSocket(socket);
  socket.serializeAttachment({boardId,expiresAt:Date.now()+8000,authenticated:false});
 }
 peers(message:any,exclude?:any){
  if(this.paused)return;
  const encoded=JSON.stringify(message),now=Date.now();
  for(const socket of this.state.getWebSockets()){
   const peer=socket.deserializeAttachment();
   if(socket===exclude||!peer?.authenticated||peer.expiresAt<=now)continue;
   try{socket.send(encoded);}catch{}
  }
 }
 async message(socket:any,raw:string|ArrayBuffer){
  if(typeof raw!=='string'||raw.length>70000){socket.close(1009,'Message too large');return;}
  let message;try{message=JSON.parse(raw);}catch{socket.close(1003,'Invalid message');return;}
  let peer=socket.deserializeAttachment();if(!peer)return;
  if(message?.type==='auth'){
   const generation=this.generation;
   try{
    if(!await this.available())throw Error('Permissions are changing');
    if(typeof message.tabId!=='string'||!message.tabId||message.tabId.length>100)throw Error('Invalid tab');
    const permission=await this.authorize(peer.boardId,message);
    if(this.paused||generation!==this.generation||!permission||permission.expiresAt<=Date.now())throw Error('Access changed');
    peer={...permission,boardId:peer.boardId,tabId:message.tabId,authenticated:true,count:0,window:Date.now()};
    socket.serializeAttachment(peer);
    socket.send(JSON.stringify({type:'ready',userId:peer.userId,role:peer.role}));
   }catch{socket.close(4003,'Reconnect to verify board access');}
   return;
  }
  if(this.paused||!peer.authenticated||peer.expiresAt<=Date.now()){socket.close(4003,'Verify board access');return;}
  const now=Date.now();if(now-peer.window>=1000){peer.window=now;peer.count=0;}
  if(++peer.count>100){socket.close(4008,'Too many updates');return;}socket.serializeAttachment(peer);
  const sender={userId:peer.userId,tabId:peer.tabId,name:peer.name,color:peer.color};
  if(message.type==='cursor'){
   const p=message.position;
   if(p!==null&&(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>1e7||Math.abs(p.y)>1e7))return;
   this.peers({type:'cursor',...sender,position:p===null?null:{x:p.x,y:p.y},expiresAt:now+10000},socket);
  }else if(message.type==='text'){
   if(peer.role==='viewer'||typeof message.nodeKey!=='string'||!/^[\w-]{1,160}$/.test(message.nodeKey)||!['body','title','draft'].includes(message.field)||typeof message.text!=='string'||message.text.length>50000||!Number.isSafeInteger(message.epoch)||message.epoch<0)return;
   this.peers({type:'text',...sender,nodeKey:message.nodeKey,field:message.field,text:message.text,epoch:message.epoch,expiresAt:now+4000},socket);
  }else if(message.type==='clear'){
   this.peers({type:'clear',...sender},socket);
  }
 }
 closed(socket:any){const peer=socket.deserializeAttachment();if(peer?.authenticated)this.peers({type:'leave',userId:peer.userId,tabId:peer.tabId},socket);}
 prune(){for(const socket of this.state.getWebSockets()){if(socket.deserializeAttachment()?.expiresAt<=Date.now())socket.close(4003,'Session expired');}}
}
