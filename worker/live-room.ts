import {LiveRoomCore} from '../backend/live-room';
import {withDatabase,identity,engine,pool} from '../backend/service';

export class BoardLiveRoom {
 core:LiveRoomCore;
 constructor(public state:any,public env:any){
  this.core=new LiveRoomCore(state,(boardId,message)=>withDatabase(env.HYPERDRIVE.connectionString,async()=>{
   if(typeof message.accessToken!=='string'||message.accessToken.length>16000||typeof message.token!=='string'||message.token.length>2000)throw Error('Invalid credentials');
   const who=await identity(message.accessToken);
   const permission=await engine.call('collaboration:liveSession',{boardId,token:message.token},who,'query');
   if(message.accessToken){const claims=JSON.parse(Buffer.from(message.accessToken.split('.')[1],'base64url').toString());if(!Number.isFinite(claims.exp))throw Error('Expired credentials');permission.expiresAt=Math.min(permission.expiresAt,claims.exp*1000);}
   return permission;
  }),xid=>withDatabase(env.HYPERDRIVE.connectionString,async()=>{
   const {rows}=await pool.query('select pg_xact_status($1::xid8) as status',[xid]);return rows[0]?.status||null;
  }));
 }
 async fetch(request:Request){
  // Only the Worker can address this object. The public route never forwards POST.
  if(request.method==='POST'){
   const {xid}=await request.json() as any;await this.core.pause(xid);return new Response('Paused');
  }
  if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required',{status:426});
  if(this.state.getWebSockets().length>=128)return new Response('Room is full',{status:429});
  const boardId=new URL(request.url).searchParams.get('board')||'';
  const pair=new (globalThis as any).WebSocketPair();this.core.accept(pair[1],boardId);
  if(!await this.state.storage.getAlarm())await this.state.storage.setAlarm(Date.now()+10000);
  return new Response(null,{status:101,webSocket:pair[0]} as any);
 }
 webSocketMessage(socket:any,message:string|ArrayBuffer){return this.core.message(socket,message);}
 webSocketClose(socket:any){this.core.closed(socket);try{socket.close();}catch{}}
 webSocketError(socket:any){this.core.closed(socket);try{socket.close();}catch{}}
 async alarm(){this.core.prune();if(this.state.getWebSockets().length)await this.state.storage.setAlarm(Date.now()+10000);}
}
