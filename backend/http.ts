import {configured,publicConfig,requestClient,authenticate,upload,rateLimit} from './service';
import {encode,decode} from './codec';
import {createHash} from 'node:crypto';
export async function route(req:any,res:any,url:URL){
 const json=(status:number,data:any)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(encode(data)));};
 if(!configured())return json(503,{error:'Supabase is not configured yet.'});
 if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&req.headers.origin!==url.origin)return json(403,{error:'Invalid origin'});
 if(url.pathname==='/api/config')return json(200,publicConfig());
 if(req.method!=='POST')return json(405,{error:'Method not allowed'});
 try{
  if(url.searchParams.has('upload'))return await upload(req,res,url);
  if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'JSON required'});
  let text='';if(req.body!==undefined)text=typeof req.body==='string'?req.body:JSON.stringify(req.body);else for await(const chunk of req){text+=chunk.toString();if(Buffer.byteLength(text)>4*1024*1024)return json(413,{error:'Request too large'});}
  if(Buffer.byteLength(text)>4*1024*1024)return json(413,{error:'Request too large'});
  const body=decode(JSON.parse(text));
  const ip=process.env.CLOUDFLARE_WORKER==='true'?String(req.headers['cf-connecting-ip']||req.socket?.remoteAddress||'unknown'):process.env.VERCEL?String(req.headers['x-forwarded-for']||'').split(',')[0]:req.socket?.remoteAddress||'local';
  if(body.auth)return json(200,await authenticate(body.auth,body.args||{},ip));
  const {kind,name,args={}}=body;
  if(!['query','mutation','action'].includes(kind)||typeof name!=='string')return json(400,{error:'Invalid operation'});
  await rateLimit('rpc:'+createHash('sha256').update(ip).digest('hex'),4000,60);
  const result=await requestClient(req)[kind](name,args);return json(200,{value:result});
 }catch(error:any){
  // Log only stack locations; never SQL, arguments, tokens, or error messages.
  if(process.env.CLOUDFLARE_WORKER==='true')console.error('RPC failure',error?.name,String(error?.stack||'').split('\n').slice(1,4).join('\n'));
  // Never return database errors, internal SQL, credentials, or stack traces.
  const message=error?.code||error?.message?.includes('postgres')?'Could not complete this request.':String(error?.message||'Request failed').slice(0,240);
  return json(400,{error:message});
 }
}
export {engine,pool,admin,configured,publicConfig,requestClient,identity} from './service';
