const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ConvexHttpClient } = require('convex/browser');

const env = {};
try { for (const line of fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) { const at=line.indexOf('=');if(at>0)env[line.slice(0,at).trim()]=line.slice(at+1).trim(); } } catch {}
const url = process.env.CONVEX_URL || env.CONVEX_URL;
const secret = process.env.DEV_BRIDGE_SECRET || env.DEV_BRIDGE_SECRET;
const convex = url ? new ConvexHttpClient(url) : null;

function verifiedIdentity(req){const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(c=>c.trim().split('=')));const [key,signature]=(cookies.branch_dev_identity||'').split('.');if(!secret||!key||!signature)return null;const expected=crypto.createHmac('sha256',secret).update(key).digest('hex');return signature===expected?key:null;}
function requestClient(req){const c=new ConvexHttpClient(url);const bearer=req.headers.authorization?.replace(/^Bearer /,'');if(bearer)c.setAuth(bearer);return c;}
module.exports = async function accountRoute(req,res,requestURL){
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 if(!convex){res.statusCode=503;res.end(JSON.stringify({error:'The account service is unavailable.'}));return;}
 if(req.headers['sec-fetch-site']==='cross-site'){res.statusCode=403;res.end('{}');return;}
 try{
  if(requestURL.pathname==='/api/config'){let legacy=[];const identityKey=verifiedIdentity(req);if(identityKey)legacy=await convex.query('library:claimInfo',{secret,identityKey});res.end(JSON.stringify({url,legacy}));return;}
  if(requestURL.pathname==='/api/claim'&&req.method==='POST'){const identityKey=verifiedIdentity(req);if(!identityKey)throw Error('The original workspace is not available in this browser.');const boardIds=await requestClient(req).mutation('library:claim',{secret,identityKey});res.end(JSON.stringify({boardIds}));return;}
  res.statusCode=410;res.end(JSON.stringify({error:'Sign in to access your boards.'}));
 }catch(error){res.statusCode=403;res.end(JSON.stringify({error:'Could not complete this account request. Sign in and try again.'}));}
};
module.exports.authorizeBoard=async(req,{readOnly=false}={})=>{if(!url)return false;const boardId=req.headers['x-board-id'];if(!boardId)return false;try{const permission=await requestClient(req).query('library:permission',{boardId,token:req.headers['x-board-token']||''});return !!permission&&(readOnly||permission.role!=='viewer');}catch{return false;}};

module.exports.peopleContext=async(req)=>requestClient(req).query('people:context',{boardId:req.headers['x-board-id'],token:req.headers['x-board-token']||''});

module.exports.resolveFiles=async(req,contexts)=>{for(const c of contexts){const a=c.attachment;if(!a?.storageId)continue;const file=await requestClient(req).query('files:read',{boardId:req.headers['x-board-id'],token:req.headers['x-board-token']||'',storageId:a.storageId});if(a.kind==='pdf'?file.mime!=='application/pdf':!/^image\/(png|jpeg|webp|gif)$/.test(file.mime||''))throw Error('Unsupported file');c.attachment={kind:a.kind,url:file.url};}};
