// Explicit provisioning utility. Never prints credentials or API response bodies.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const config=require('../backend/config.cjs');
const account='7463e61beec84f503e6edab2ed2bdc5d';
const auth=fs.readFileSync(path.join(os.homedir(),'Library/Preferences/.wrangler/config/default.toml'),'utf8');
const token=auth.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if(!token)throw Error('Sign in with Wrangler first');
async function api(route,body){const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok||!d.success)throw Error('Cloudflare operation failed: HTTP '+r.status+' code '+d.errors?.map(x=>x.code+': '+String(x.message).replaceAll(decodeURIComponent(new URL(config.database).password),'[redacted]')).join(','));return d.result;}
(async()=>{
 try{const subscriptions=await api('/subscriptions');console.log('Plans:',subscriptions.map(x=>x.rate_plan?.id||x.id));}catch{console.log('Billing plan is not readable with deployment token. No plan change requested.');}
 let drives=await api('/hyperdrive/configs'),drive=drives.find(x=>x.name==='branch-supabase');
 if(!drive){
  // Trust the official Supabase CA and verify the database hostname.
  const certs=await api('/mtls_certificates');
  let ca=certs.find(x=>x.name==='branch-supabase-ca');
  if(!ca)ca=await api('/mtls_certificates',{name:'branch-supabase-ca',ca:true,certificates:fs.readFileSync('backend/certs/supabase-ca.crt','utf8')});
  const u=new URL(config.database);
  drive=await api('/hyperdrive/configs',{name:'branch-supabase',origin:{scheme:'postgres',host:u.hostname,port:Number(u.port)||5432,database:u.pathname.slice(1),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password)},caching:{disabled:true},mtls:{sslmode:'verify-full',ca_certificate_id:ca.id},origin_connection_limit:10});
 }
 const result={account,hyperdriveId:drive.id,queue:'branch-jobs',worker:'branch',cachingDisabled:drive.caching?.disabled,sslmode:drive.mtls?.sslmode};
 fs.writeFileSync('backups/cloudflare-resources.json',JSON.stringify(result,null,2),{mode:0o600});console.log(result);
})();
