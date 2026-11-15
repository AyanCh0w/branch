import {createClient} from '@supabase/supabase-js';
export const api=new Proxy({}, {get:(_,module)=>new Proxy({}, {get:(_,fn)=>String(module)+':'+String(fn)})});
export const makeFunctionReference=name=>String(name);
function encode(v){if(v===undefined)return {$branch:'undefined'};if(v instanceof ArrayBuffer){const bytes=new Uint8Array(v);let s='';for(const b of bytes)s+=String.fromCharCode(b);return {$branch:'bytes',value:btoa(s)};}if(Array.isArray(v))return v.map(encode);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).map(([k,x])=>[k,encode(x)]));return v;}
function decode(v){if(v&&typeof v==='object'&&!Array.isArray(v)){if(v.$branch==='bytes'&&Object.keys(v).length===2)return Uint8Array.from(atob(v.value),c=>c.charCodeAt(0)).buffer;if(v.$branch==='undefined'&&Object.keys(v).length===1)return undefined;return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)]));}return Array.isArray(v)?v.map(decode):v;}
export class BranchClient {
 constructor(config){
  this.supabase=createClient(config.url,config.publishableKey);this.session=null;this.loading=true;this.online=false;this.epoch=0;this.watchers=new Set();this.authListeners=new Set();this.connectionListeners=new Set();
  this.supabase.auth.onAuthStateChange((_event,session)=>{this.session=session;this.loading=false;this.epoch++;for(const fn of this.authListeners)fn();queueMicrotask(()=>{this.connectRealtime();this.invalidate();});});
  this.supabase.auth.getSession().then(({data})=>{if(this.loading){this.session=data.session;this.loading=false;for(const fn of this.authListeners)fn();this.connectRealtime();}});
 }
 connectRealtime(){
  this.realtimeTask=(this.realtimeTask||Promise.resolve()).then(async()=>{
   const epoch=this.epoch;
   if(this.channel)await this.supabase.removeChannel(this.channel);
   this.channel=null;
   if(!this.session||epoch!==this.epoch)return;
   await this.supabase.realtime.setAuth(this.session.access_token);
   if(epoch!==this.epoch)return;
   this.channel=this.supabase.channel('branch:'+this.session.user.id+':'+epoch)
    .on('system',{},message=>{if(message.status==='ok'&&message.extension==='postgres_changes')this.invalidate();})
    .on('postgres_changes',{event:'*',schema:'public',table:'branch_revisions',filter:'user_id=eq.'+this.session.user.id},()=>this.invalidate())
    .subscribe(status=>{if(status==='SUBSCRIBED')this.invalidate();});
  }).catch(()=>{}); // Polling continues while Realtime reconnects.
 }

 state(online){if(this.online===online)return;this.online=online;for(const fn of this.connectionListeners)fn(this.connectionState());}
 connectionState(){return {isWebSocketConnected:this.online};}
 subscribeToConnectionState(fn){this.connectionListeners.add(fn);return()=>this.connectionListeners.delete(fn);}
 async call(kind,name,args){
  const token=this.session?.access_token;let r;
  try{r=await fetch('/api/backend',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(encode({kind,name:String(name),args})),signal:AbortSignal.timeout(kind==='action'?180000:30000)});}catch(e){this.state(false);throw e;}
  this.state(true);const data=decode(await r.json());if(!r.ok)throw Error(data.error||'Request failed');if(kind!=='query')this.invalidate();return data.value;
 }
 query(name,args={}){return this.call('query',name,args);}
 mutation(name,args={}){return this.call('mutation',name,args);}
 action(name,args={}){return this.call('action',name,args);}
 invalidate(){for(const watcher of this.watchers)watcher();}
 onUpdate(name,args,callback,onError){
  let stopped=false,running=false,again=false,last,version=-1;
  const refresh=async()=>{if(stopped)return;if(running){again=true;return;}running=true;const epoch=this.epoch;try{const value=await this.query(name,args);const key=JSON.stringify(encode(value));if(!stopped&&epoch===this.epoch&&(key!==last||epoch!==version)){last=key;version=epoch;callback(value);}}catch(e){if(!stopped&&epoch===this.epoch)onError?.(e);}finally{running=false;if(again&&!stopped){again=false;queueMicrotask(refresh);}}};
  this.watchers.add(refresh);refresh();
  // Revalidate capability grants even if a realtime notification is lost. Guests lack an Auth JWT.
  const interval=setInterval(()=>{if(!document.hidden)refresh();},args?.token?1000:3000);
  const visible=()=>{if(!document.hidden)refresh();};document.addEventListener('visibilitychange',visible);
  return()=>{stopped=true;clearInterval(interval);this.watchers.delete(refresh);document.removeEventListener('visibilitychange',visible);};
 }
 async auth(action,args){const r=await fetch('/api/backend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({auth:action,args})});const result=await r.json();if(!r.ok)throw Error(result.error||'Could not sign in');if(result.session){const {error}=await this.supabase.auth.setSession(result.session);if(error)throw error;}return result;}
 async signOut(){const {error}=await this.supabase.auth.signOut();if(error)throw error;}
 close(){if(this.channel)this.supabase.removeChannel(this.channel);this.watchers.clear();}
}
