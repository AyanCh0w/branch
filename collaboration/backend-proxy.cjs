// Public /api/backend?coding|chrome|desktop endpoints. Origin rules stay here, next to
// the request's real socket and Host. Work is forwarded to Convex HTTP actions, which
// only accept requests carrying BRANCH_PROXY_SECRET.
const {setting}=require('./server.cjs');
const {isChromeSyncOrigin,validSyncClient,EXTENSION_ORIGIN}=require('./chrome-sync.cjs');
const LIMIT={coding:256*1024,sync:128*1024};
function json(res,status,data,extra={}){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer',...extra});res.end(JSON.stringify(data));}
async function body(req,limit){
 if(req.body!==undefined){const data=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));return data.length<=limit?data:null;}
 const chunks=[];let size=0;for await(const part of req){const chunk=Buffer.from(part);size+=chunk.length;if(size>limit)return null;chunks.push(chunk);}return Buffer.concat(chunks);
}
async function forward(res,path,init){
 const site=setting('CONVEX_SITE_URL'),secret=setting('BRANCH_PROXY_SECRET');
 if(!site||!secret)return json(res,503,{error:'This service is not configured yet.'});
 const upstream=await fetch(site.replace(/\/$/,'')+path,{...init,headers:{...init.headers,'x-branch-proxy':secret}});
 const headers={'Cache-Control':'no-store'};for(const key of ['content-type','www-authenticate'])if(upstream.headers.get(key))headers[key]=upstream.headers.get(key);
 res.writeHead(upstream.status,headers);res.end(Buffer.from(await upstream.arrayBuffer()));
}
async function route(req,res,url){
 const reply=(status,data,extra)=>json(res,status,data,extra);
 try{
  if(url.searchParams.has('coding')){
   if(req.headers.origin||req.headers['sec-fetch-site']==='cross-site')return reply(403,{error:'Invalid origin'});
   if(req.method!=='POST')return reply(405,{error:'Method not allowed'});
   const data=await body(req,LIMIT.coding);if(data===null)return reply(413,{error:'Request too large'});
   const headers={'content-type':String(req.headers['content-type']||'application/json'),accept:String(req.headers.accept||'application/json, text/event-stream')};
   if(req.headers.authorization)headers.authorization=String(req.headers.authorization);
   if(req.headers['mcp-protocol-version'])headers['mcp-protocol-version']=String(req.headers['mcp-protocol-version']);
   return await forward(res,'/branch/coding',{method:'POST',headers,body:data});
  }
  if(url.searchParams.has('chrome')||url.searchParams.has('desktop')){
   const desktop=url.searchParams.has('desktop');
   if((desktop&&url.searchParams.has('chrome'))||!validSyncClient(url.origin,req.headers,req.socket?.remoteAddress,desktop))return reply(403,{error:'Invalid origin'});
   const cors=!desktop&&req.headers.origin===EXTENSION_ORIGIN?{'Access-Control-Allow-Origin':EXTENSION_ORIGIN,Vary:'Origin'}:{};
   if(cors['Access-Control-Allow-Origin']&&req.method==='OPTIONS'){
    if(req.headers['access-control-request-method']!=='POST'||String(req.headers['access-control-request-headers']||'').split(',').some(h=>h.trim()&&h.trim().toLowerCase()!=='content-type'))return reply(403,{error:'Invalid preflight'},cors);
    res.writeHead(204,{...cors,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type'});return res.end();
   }
   for(const [k,v] of Object.entries(cors))res.setHeader(k,v);
   if(req.method!=='POST')return reply(405,{error:'Method not allowed'});
   if(!req.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'JSON required'});
   const op=url.searchParams.get(desktop?'desktop':'chrome');
   if(!['status','save','stop'].includes(op))return reply(400,{error:'Invalid operation'});
   const data=await body(req,LIMIT.sync);if(data===null)return reply(413,{error:'Request too large'});
   return await forward(res,'/branch/sync?op='+op+(desktop?'&source=desktop':''),{method:'POST',headers:{'content-type':'application/json'},body:data});
  }
  return reply(410,{error:'This endpoint moved to Convex.'});
 }catch{if(!res.headersSent)reply(502,{error:'Could not complete this request.'});else res.end();}
}
module.exports={route,isChromeSyncOrigin};
