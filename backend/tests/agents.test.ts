import {describe,it,expect,beforeAll,afterAll,vi} from 'vitest';
import {createHash,createHmac} from 'node:crypto';
import {Readable} from 'node:stream';
const shared=vi.hoisted(()=>({engine:null as any}));
// The HTTP adapter runs against the in-memory database instead of a real Supabase project.
vi.mock('../service',()=>({get engine(){return shared.engine;},configured:()=>true,rateLimit:async()=>{}}));
import {harness} from './harness';
import {agentRoute,agentPaths} from '../agents';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const key='branch_'+'a'.repeat(64);
let h:Awaited<ReturnType<typeof harness>>,owner:any,boardId:string;
// A minimal Node request/response pair, as the app server passes them.
async function call(path:string,{method='POST',headers={},body}:{method?:string;headers?:Record<string,string>;body?:string}={}){
 const req:any=Readable.from(body===undefined?[]:[Buffer.from(body)]);req.method=method;req.headers={host:'127.0.0.1:4387',...headers};req.socket={remoteAddress:'127.0.0.1'};
 let status=0,sent:any={},text='';
 const res:any={headersSent:false,writeHead(code:number,head:any){status=code;sent=head||{};this.headersSent=true;},end(chunk?:any){if(chunk)text+=Buffer.from(chunk).toString();}};
 await agentRoute(req,res,new URL(path,'http://127.0.0.1:4387'));
 return {status,headers:sent,text};
}
const sign=(body:string)=>'sha256='+createHmac('sha256','hook-secret').update(body).digest('hex');
const jobs=async()=>(await h.pool.query("select count(*)::int as n from branch_private.jobs where function_name='githubActions:webhook'")).rows[0].n;

beforeAll(async()=>{
 h=await harness();shared.engine=h.engine;owner=await h.account('owner');
 boardId=await h.call(owner,'library:create',{title:'Agents'});
 await h.call(owner,'coding:configure',{boardId,token:'',keyHash:hash(key)});
});
afterAll(async()=>{vi.unstubAllEnvs();await h.close();});

describe('agent HTTP endpoints',()=>{
 it('serves only the known paths',async()=>{
  expect(agentPaths).toContain('/api/mcp');expect(agentPaths).toContain('/api/github/webhook');
  expect((await call('/api/unknown')).status).toBe(404);
 });
 it('answers MCP requests for a valid board key and refuses everyone else',async()=>{
  const init=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}});
  const headers={'content-type':'application/json',accept:'application/json, text/event-stream'};
  const ok=await call('/api/mcp',{headers:{...headers,authorization:'Bearer '+key},body:init});
  expect(ok.status).toBe(200);expect(ok.headers['cache-control']).toBe('no-store');
  expect(JSON.parse(ok.text).result.serverInfo.name).toBe('branch');expect(JSON.parse(ok.text).result.instructions).toContain('get_board_brief');
  expect((await call('/api/mcp',{headers,body:init})).status).toBe(401);
  expect((await call('/api/mcp',{headers:{...headers,authorization:'Bearer branch_'+'b'.repeat(64)},body:init})).status).toBe(401);
  expect((await call('/api/mcp',{headers:{...headers,authorization:'Bearer '+key,origin:'https://other.example'},body:init})).status).toBe(403);
  expect((await call('/api/mcp',{method:'GET',headers:{authorization:'Bearer '+key}})).status).toBe(405);
 });
 it('publishes connector discovery that points at this origin',async()=>{
  const server=JSON.parse((await call('/.well-known/oauth-authorization-server',{method:'GET'})).text);
  expect(server).toMatchObject({issuer:'http://127.0.0.1:4387',authorization_endpoint:'http://127.0.0.1:4387/api/chatgpt/authorize',token_endpoint:'http://127.0.0.1:4387/api/chatgpt/token'});
  const resource=JSON.parse((await call('/.well-known/oauth-protected-resource/api/chatgpt/mcp',{method:'GET'})).text);
  expect(resource.resource).toBe('http://127.0.0.1:4387/api/chatgpt/mcp');
 });
 it('accepts GitHub deliveries only with a valid signature',async()=>{
  const body=JSON.stringify({ref:'refs/heads/main',repository:{id:42},commits:[{modified:['app/context.js']}]});
  const headers={'content-type':'application/json','x-github-event':'push'};
  // Disabled until a secret is configured.
  expect((await call('/api/github/webhook',{headers:{...headers,'x-hub-signature-256':sign(body)},body})).status).toBe(404);
  vi.stubEnv('GITHUB_WEBHOOK_SECRET','hook-secret');
  expect((await call('/api/github/webhook',{headers,body})).status).toBe(401);
  expect((await call('/api/github/webhook',{headers:{...headers,'x-hub-signature-256':sign(body+' ')},body})).status).toBe(401);
  expect(await jobs()).toBe(0);
  expect((await call('/api/github/webhook',{headers:{...headers,'x-hub-signature-256':sign(body)},body})).status).toBe(202);
  expect(await jobs()).toBe(1);
  // Events Branch does not act on are acknowledged and dropped.
  const ping=JSON.stringify({zen:'hi',repository:{id:42}});
  expect((await call('/api/github/webhook',{headers:{...headers,'x-github-event':'ping','x-hub-signature-256':sign(ping)},body:ping})).status).toBe(202);
  expect(await jobs()).toBe(1);
  expect((await call('/api/github/webhook',{method:'GET'})).status).toBe(405);
 });
});
