const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');

const bundle=readFileSync(path.join(__dirname,'../accounts.bundle.js'),'utf8');
for(const [route,heading] of [['/app','Welcome back.'],['/app?auth=signup','Create your account.']]){
 test(`a deleted account's saved session recovers on ${route}`,async()=>{
  const dom=new JSDOM('<div id="account-app"></div>',{url:'https://branch.test'+route,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  const storageKey='sb-example-auth-token';
  const expiresAt=Math.floor(Date.now()/1000)+3600;
  const token=[{alg:'HS256'},{sub:'deleted-user',exp:expiresAt}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.dGVzdA';
  w.localStorage.setItem(storageKey,JSON.stringify({access_token:token,refresh_token:'test-refresh',expires_at:expiresAt,user:{id:'deleted-user'}}));
  w.Iconoir={};
  const requests=[];
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  w.fetch=async(input,options)=>{
   const url=String(input);
   if(url==='/api/config')return json({url:'https://example.supabase.co',publishableKey:'test-key'});
   if(url==='/api/backend'){
    requests.push(options.headers.Authorization);
    return json({error:'Sign in again'},401);
   }
   if(url==='https://example.supabase.co/auth/v1/logout?scope=local')return json({code:'user_not_found',msg:'User not found'},403);
   throw Error('Unexpected request: '+url);
  };
  try{
   w.eval(bundle);
   for(let i=0;i<100&&!w.document.querySelector('.a-auth-form');i++)await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal(w.document.querySelector('.a-auth-form h2')?.textContent,heading);
   assert.ok(requests.includes('Bearer '+token));
   assert.equal(w.localStorage.getItem(storageKey),null);
   assert.doesNotMatch(w.document.body.textContent,/This link isn’t available/);
  }finally{w.close();}
 });
}
