'use strict';
const dns=require('node:dns').promises;
const http=require('node:http'),https=require('node:https');
// Resolve once and pin the connection to a public IPv4 address, including every redirect.
function publicIPv4(address){
 const p=address.split('.').map(Number);if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
 const [a,b]=p;return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0));
}
function ancestorMatches(source,parent,target){
 if(source==="'none'")return false;
 if(source==="'self'")return parent.origin===target.origin;
 if(source==='*')return true;
 if(/^https?:$/.test(source))return parent.protocol===source||(source==='http:'&&parent.protocol==='https:');
 try{
  const wildcard=source.includes('://*.')||source.startsWith('*.');
  const anyPort=source.endsWith(':*');
  const candidate=new URL((source.includes('://')?'':target.protocol+'//')+source.replace('*.', 'wildcard.').replace(/:\*$/, ''));
  const hostname=wildcard?candidate.hostname.slice(9):candidate.hostname;
  return (candidate.protocol===parent.protocol||(candidate.protocol==='http:'&&parent.protocol==='https:'))&&(wildcard?parent.hostname.endsWith('.'+hostname):candidate.hostname===parent.hostname)&&(anyPort||candidate.port===parent.port);
 }catch{return null;} // Unknown CSP syntax must not hide a potentially working preview.
}
function blockedByHeaders(headers,target,parent){
 const policies=String(headers['content-security-policy']||'').split(',');let hasAncestors=false;
 for(const policy of policies){const directive=policy.split(';').map(s=>s.trim()).find(s=>/^frame-ancestors(?:\s|$)/i.test(s));if(!directive)continue;hasAncestors=true;const sources=directive.split(/\s+/).slice(1);if(!sources.some(s=>ancestorMatches(s,parent,target)!==false))return true;}
 if(hasAncestors)return false; // Enforced CSP supersedes X-Frame-Options.
 const xfo=String(headers['x-frame-options']||'').toUpperCase().split(',').map(s=>s.trim());
 return xfo.includes('DENY')||(xfo.includes('SAMEORIGIN')&&target.origin!==parent.origin);
}
async function requestHeaders(url,signal){
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port)))throw Error('Unsupported URL');
 const records=await dns.lookup(url.hostname,{family:4,all:true});
 if(!records.length||records.some(r=>!publicIPv4(r.address)))throw Error('Private address');
 signal.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const req=(url.protocol==='https:'?https:http).request(url,{method:'GET',signal,agent:false,lookup:(_host,options,cb)=>cb(null,...(options.all?[[records[0]]]:[records[0].address,4])),headers:{'User-Agent':'Branch-Preview-Check/1.0','Accept':'text/html'}},res=>{resolve({status:res.statusCode,headers:res.headers});res.destroy();});
  req.on('error',reject);req.end();
 });
}
let active=0;
async function checkEmbed(value,origin,{request=requestHeaders}={}){
 if(active>=8)return {status:'unknown'};active++;
 try{
  let target=new URL(value);const parent=new URL(origin),signal=AbortSignal.timeout(8000);
  for(let redirects=0;redirects<=4;redirects++){
   const result=await request(target,signal);
   if([301,302,303,307,308].includes(result.status)&&result.headers.location){target=new URL(result.headers.location,target);continue;}
   if(blockedByHeaders(result.headers,target,parent))return {status:'blocked'};
   if([404,410].includes(result.status)||result.status>=500)return {status:'unavailable'};
   return {status:result.status>=200&&result.status<300?'allowed':'unknown'};
  }
  return {status:'unknown'};
 }catch{return {status:'unknown'};}finally{active--;}
}
module.exports={checkEmbed,blockedByHeaders,publicIPv4};
