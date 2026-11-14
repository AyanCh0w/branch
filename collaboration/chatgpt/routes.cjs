'use strict';
const {hash,random}=require('./protocol.cjs');
module.exports=async function route(req,res,url,client,{hosted=false}={}){
 const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(body));};
 const cookieName=hosted?'__Host-branch-chatgpt':'branch-chatgpt';
 const cookie=(value,age)=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${hosted?'; Secure':''}`;
 if(url.searchParams.get('action')==='callback'&&req.method==='GET'){
  const browserSecret=(req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  res.setHeader('Set-Cookie',cookie('',0));res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  try{if(!browserSecret)throw Error();const result=await client.action('chatgptActions:finish',{state:url.searchParams.get('state')||'',browserSecret,...(url.searchParams.has('code')?{code:url.searchParams.get('code')}:{}),...(url.searchParams.has('error')?{error:url.searchParams.get('error')}:{})});const target=new URL(result.returnPath,'https://branch.invalid');target.searchParams.set('chatgpt','connected');res.writeHead(303,{Location:target.pathname+target.search});res.end();}catch{res.writeHead(303,{Location:'/app?chatgpt=failed'});res.end();}return;
 }
 if(req.method!=='POST'||url.searchParams.get('action')!=='start')return json(405,{error:'Method not allowed'});
 if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&req.headers.origin!==url.origin)return json(403,{error:'Invalid origin'});
 if(!req.headers.authorization?.startsWith('Bearer '))return json(401,{error:'Sign in to connect ChatGPT.'});
 try{const browserSecret=random();let returnPath='/app';if(req.headers.referer){const ref=new URL(req.headers.referer);if(ref.origin===url.origin&&ref.pathname==='/app'){ref.searchParams.delete('chatgpt');returnPath=ref.pathname+ref.search;}}
 const result=await client.action('chatgptActions:start',{browserHash:hash(browserSecret),returnPath});res.setHeader('Set-Cookie',cookie(browserSecret,600));return json(200,result);
 }catch{return json(503,{error:'ChatGPT connection is not available. Try again later; Branch default is still available.'});}
};
