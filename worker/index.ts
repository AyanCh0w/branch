import {createServer} from 'node:http';
import {handleAsNodeRequest} from 'cloudflare:node';
import {env} from 'cloudflare:workers';
import {createHandler} from '../app/server.cjs';
import {withDatabase,pool,engine} from '../backend/service';
import {tick} from '../backend/runner';
import {expireJobs} from '../backend/jobs';

const wake=()=>env.JOBS.send({type:'wake'});
const handler=createHandler(process.env.OPENAI_API_KEY,{hosted:true});
createServer((req,res)=>{
 withDatabase(env.HYPERDRIVE.connectionString,()=>handler(req,res),wake).catch(()=>{
  console.error('Branch API request failed');
  if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});
  if(!res.writableEnded)res.end(JSON.stringify({error:'Service temporarily unavailable. Please retry.'}));
 });
}).listen(8080);

export default {
 async fetch(request:Request){
  const url=new URL(request.url);
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
  },wake);
 },
 async scheduled(){
  await withDatabase(env.HYPERDRIVE.connectionString,async()=>{
   await expireJobs(engine);
   const {rows}=await pool.query("select id from branch_private.jobs where status='pending' and due_at<=now() order by due_at limit 100");
   if(rows.length)await env.JOBS.sendBatch(rows.map(()=>({body:{type:'wake'}})));
  },wake);
 }
};
