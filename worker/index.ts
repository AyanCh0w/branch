import {createServer} from 'node:http';
import {handleAsNodeRequest} from 'cloudflare:node';
import {env} from 'cloudflare:workers';
import {createHandler} from '../app/server.cjs';

// Data, live updates, jobs and scheduled work run on Convex. This Worker serves the
// site and the Node routes (AI proxy, previews, sync forwarding) only.
const handler=createHandler(process.env.OPENAI_API_KEY,{hosted:true});
createServer((req,res)=>{
 Promise.resolve(handler(req,res)).catch(()=>{
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
 }
};
