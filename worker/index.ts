export {BoardLiveRoom} from './live-room';
import {createServer} from 'node:http';
import {handleAsNodeRequest} from 'cloudflare:node';
import {env} from 'cloudflare:workers';
import {createHandler} from '../app/server.cjs';
import {withDatabase,pool,engine} from '../backend/service';
import {tick} from '../backend/runner';
import {expireJobs} from '../backend/jobs';

const barrier=async(boards:string[],xid:string)=>{await Promise.all(boards.map(async board=>{const room=env.BOARD_LIVE.get(env.BOARD_LIVE.idFromName(board));const response=await room.fetch('https://room/pause',{method:'POST',body:JSON.stringify({xid})});if(!response.ok)throw Error('Live access barrier unavailable');}));};
const changed=async(change:any)=>{await Promise.all(change.boards.map(async(board:string)=>{
 const room=env.BOARD_LIVE.get(env.BOARD_LIVE.idFromName(board));
 const response=await room.fetch('https://room/changed',{method:'POST',body:JSON.stringify({change:{...change,boards:[board]}})});
 if(!response.ok)throw Error('Live notification unavailable');
}));};
const wake=()=>env.JOBS.send({type:'wake'});
const handler=createHandler(process.env.OPENAI_API_KEY,{hosted:true});
createServer((req,res)=>{
 withDatabase(env.HYPERDRIVE.connectionString,()=>handler(req,res),wake,barrier,changed).catch(()=>{
  console.error('Branch API request failed');
  if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
  if(!res.writableEnded)res.end(JSON.stringify({error:'Service temporarily unavailable. Please retry.'}));
 });
}).listen(8080);

export default {
 async fetch(request:Request){
  const url=new URL(request.url);
  if(url.pathname==='/api/live'){
   if(request.method!=='GET'||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required',{status:426});
   if(request.headers.get('Origin')!==url.origin)return new Response('Origin denied',{status:403});
   const board=url.searchParams.get('board')||'';if(!/^[A-Za-z0-9_-]{1,160}$/.test(board))return new Response('Invalid board',{status:400});
   return env.BOARD_LIVE.get(env.BOARD_LIVE.idFromName(board)).fetch(request);
  }
  if(url.pathname.startsWith('/api/')||(['/','/app','/app/'].includes(url.pathname)&&(url.searchParams.has('join')||url.searchParams.has('board'))))return handleAsNodeRequest(8080,request);
  if(url.pathname==='/')url.pathname='/index.html';
  if(url.pathname==='/app'||url.pathname==='/app/')url.pathname='/workspace.html';
  return env.ASSETS.fetch(new Request(url,request));
 },
 async queue(batch:any){
  await withDatabase(env.HYPERDRIVE.connectionString,async()=>{
   // SQL claims/leases are authoritative. Duplicate queue deliveries cannot replay a paid run.
   for(const message of batch.messages){
    try{await tick();message.ack();}catch{message.retry({delaySeconds:30});}
   }
  },wake,barrier,changed);
 },
 async scheduled(){
  await withDatabase(env.HYPERDRIVE.connectionString,async()=>{
   await expireJobs(engine);
   const {rows}=await pool.query("select id from branch_private.jobs where status='pending' and due_at<=now() order by due_at limit 100");
   if(rows.length)await env.JOBS.sendBatch(rows.map(()=>({body:{type:'wake'}})));
  },wake,barrier,changed);
 }
};
