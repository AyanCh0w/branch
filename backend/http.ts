import {engine,configured,publicConfig,requestClient,authenticate,upload,rateLimit} from './service';
import {encode,decode} from './codec';
import {createHash} from 'node:crypto';
import {codingRequest} from './coding-http';
import {isChromeSyncOrigin} from '../collaboration/chrome-sync.cjs';
export async function route(req:any,res:any,url:URL){
 const json=(status:number,data:any)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(encode(data)));};
 if(!configured())return json(503,{error:'Supabase is not configured yet.'});
 if (url.searchParams.has('coding')) {
  if (req.headers.origin || req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Invalid origin' });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
   await rateLimit('coding:'+createHash('sha256').update(String(req.socket?.remoteAddress || 'local')).digest('hex'), 600, 60);
   const body = await requestBody(req, 256 * 1024);
   if (body === null) return json(413, { error: 'Request too large' });
   const headers = new Headers();
   for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
   const response = await codingRequest(new Request(url, { method: 'POST', headers, body }), engine);
   res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
   return res.end(await response.text());
  } catch {
   return json(400, { error: 'Could not complete this handoff.' });
  }
 }
 if (url.searchParams.has('chrome')) {
  const extensionOrigin = 'chrome-extension://lgbhkehiipjkjhpdkkmakodccahllneh';
  if (!isChromeSyncOrigin(url.origin) || req.headers.origin && req.headers.origin !== extensionOrigin) {
   return json(403, { error: 'Invalid origin' });
  }
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'JSON required' });
  const operation = url.searchParams.get('chrome');
  if (operation !== 'status' && operation !== 'save' && operation !== 'stop') return json(400, { error: 'Invalid operation' });
  try {
   await rateLimit('chrome:'+createHash('sha256').update(String(req.socket?.remoteAddress || 'local')).digest('hex'), 600, 60);
   const body = await requestBody(req, 128 * 1024);
   if (body === null) return json(413, { error: 'Request too large' });
   return json(200, { value: await engine.call('chatgptBrowser:' + operation, JSON.parse(body), {},
    operation === 'status' ? 'query' : 'mutation', true) });
  } catch (error: any) {
   if (error?.message === 'chrome_sync_disconnected') return json(401, { error: error.message });
   return json(400, { error: error?.code ? 'Could not complete this request.' : String(error?.message || 'Request failed').slice(0, 240) });
  }
 }
 if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&req.headers.origin!==url.origin)return json(403,{error:'Invalid origin'});
 if(url.pathname==='/api/config')return json(200,publicConfig());
 if(req.method!=='POST')return json(405,{error:'Method not allowed'});
 try{
  if(url.searchParams.has('upload'))return await upload(req,res,url);
  if(!req.headers['content-type']?.startsWith('application/json'))return json(415,{error:'JSON required'});
  const text=await requestBody(req,4*1024*1024);
  if(text===null)return json(413,{error:'Request too large'});
  const body=decode(JSON.parse(text));
  const ip=process.env.CLOUDFLARE_WORKER==='true'?String(req.headers['cf-connecting-ip']||req.socket?.remoteAddress||'unknown'):process.env.VERCEL?String(req.headers['x-forwarded-for']||'').split(',')[0]:req.socket?.remoteAddress||'local';
  if(body.auth)return json(200,await authenticate(body.auth,body.args||{},ip));
  const {kind,name,args={}}=body;
  if(!['query','mutation','action'].includes(kind)||typeof name!=='string')return json(400,{error:'Invalid operation'});
  await rateLimit('rpc:'+createHash('sha256').update(ip).digest('hex'),4000,60);
  if (name.startsWith('chatgptBrowser:') && !isChromeSyncOrigin(url.origin)) return json(403, { error: 'Chrome sync requires local Branch.' });
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

async function requestBody(req: any, limit: number) {
 if (req.body !== undefined) {
  const data = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  return data.length <= limit ? data.toString('utf8') : null;
 }
 const chunks: Buffer[] = [];
 let size = 0;
 for await (const part of req) {
  const chunk = Buffer.from(part);
  size += chunk.length;
  if (size > limit) return null;
  chunks.push(chunk);
 }
 return Buffer.concat(chunks).toString('utf8');
}
