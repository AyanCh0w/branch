import {createClient} from '@supabase/supabase-js';
export const api=new Proxy({}, {get:(_,module)=>new Proxy({}, {get:(_,fn)=>String(module)+':'+String(fn)})});
export const makeFunctionReference=name=>String(name);
function encode(v){if(v===undefined)return {$branch:'undefined'};if(v instanceof ArrayBuffer){const bytes=new Uint8Array(v);let s='';for(const b of bytes)s+=String.fromCharCode(b);return {$branch:'bytes',value:btoa(s)};}if(Array.isArray(v))return v.map(encode);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined).map(([k,x])=>[k,encode(x)]));return v;}
function decode(v){if(v&&typeof v==='object'&&!Array.isArray(v)){if(v.$branch==='bytes'&&Object.keys(v).length===2)return Uint8Array.from(atob(v.value),c=>c.charCodeAt(0)).buffer;if(v.$branch==='undefined'&&Object.keys(v).length===1)return undefined;return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)]));}return Array.isArray(v)?v.map(decode):v;}
export class BranchClient {
 constructor(config){
  this.session=null;this.loading=true;this.online=false;this.epoch=0;this.closed=false;
  this.watchers=new Set();this.authListeners=new Set();this.connectionListeners=new Set();this.subscriptions=new Map();this.realtimeReady=false;
  this.supabase=createClient(config.url,config.publishableKey,{realtime:{worker:typeof Worker!=='undefined',heartbeatCallback:status=>{
   if(['disconnected','timeout','error'].includes(status)&&!this.closed){this.realtimeReady=false;this.supabase.realtime.connect();}
  }}});
  const auth=this.supabase.auth.onAuthStateChange((_event,session)=>this.acceptSession(session));
  this.authSubscription=auth.data.subscription;
  this.supabase.auth.getSession().then(({data})=>{if(this.loading)this.acceptSession(data.session);});
  this.resume=()=>{if(this.closed||document.hidden)return;this.connectRealtime();this.invalidate(true);};
  document.addEventListener('visibilitychange',this.resume);window.addEventListener('online',this.resume);window.addEventListener('pageshow',this.resume);
 }
 acceptSession(session){
  if(this.closed)return;
  const identityChanged=this.session?.user.id!==session?.user.id;
  const tokenChanged=this.session?.access_token!==session?.access_token;
  const wasLoading=this.loading;this.session=session;this.loading=false;
  // Supabase re-emits SIGNED_IN on tab focus. Keep the board and its queries mounted.
  if(identityChanged)this.epoch++;
  if(identityChanged||tokenChanged||wasLoading)for(const fn of this.authListeners)fn();
  if(identityChanged||tokenChanged||wasLoading)setTimeout(()=>{if(!this.closed){this.connectRealtime();this.invalidate();}},0);
 }
 connectRealtime(){
  this.realtimeTask=(this.realtimeTask||Promise.resolve()).then(async()=>{
   if(this.closed)return;
   const epoch=this.epoch,session=this.session;
   if(this.channel&&this.channelUser===session?.user.id){
    if(this.channelToken!==session.access_token){await this.supabase.realtime.setAuth(session.access_token);this.channelToken=session.access_token;}
    if(!this.supabase.realtime.isConnected())this.supabase.realtime.connect();
    return;
   }
   const old=this.channel;this.channel=null;this.realtimeReady=false;
   if(old)await this.supabase.removeChannel(old);
   if(!session||epoch!==this.epoch||this.closed)return;
   await this.supabase.realtime.setAuth(session.access_token);
   if(epoch!==this.epoch||this.closed)return;
   this.channelUser=session.user.id;this.channelToken=session.access_token;
   const channel=this.supabase.channel('branch:'+session.user.id+':'+epoch);this.channel=channel;
   channel.on('postgres_changes',{event:'*',schema:'public',table:'branch_revisions',filter:'user_id=eq.'+session.user.id},event=>{if(this.channel===channel)this.invalidate(false,event?.new?.change);})
    .subscribe(status=>{if(this.channel!==channel)return;this.realtimeReady=status==='SUBSCRIBED';if(this.realtimeReady){this.state(true);this.invalidate();}});
  }).catch(()=>{this.realtimeReady=false;});
 }

 state(online){if(this.online===online)return;this.online=online;for(const fn of this.connectionListeners)fn(this.connectionState());}
 connectionState(){return {isWebSocketConnected:this.online};}
 subscribeToConnectionState(fn){this.connectionListeners.add(fn);return()=>this.connectionListeners.delete(fn);}
 async call(kind,name,args,signal,onDependencies){
  const token=this.session?.access_token;let r;
  try{r=await fetch('/api/backend',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(encode({kind,name:String(name),args})),signal:signal||AbortSignal.timeout(kind==='action'?180000:30000)});}catch(e){if(!signal?.aborted)this.state(false);e.retryable=true;throw e;}
  this.state(true);const data=decode(await r.json());if(!r.ok){const error=Error(data.error||'Request failed');error.retryable=r.status>=500||r.status===429||data.error==='Could not complete this request.';if(error.retryable)this.state(false);throw error;}if(kind==='query')onDependencies?.(data.dependencies);if(kind!=='query'){const collection={'collaboration:point':'cursors','collaboration:attend':'boardPresence','collaboration:focus':'editors','collaboration:release':'editors','collaboration:updateText':'nodes'}[name];this.invalidate(false,collection?{collections:[collection],boards:[args.boardId]}:null);}return data.value;
 }
 query(name,args={}){return this.call('query',name,args);}
 mutation(name,args={}){return this.call('mutation',name,args);}
 action(name,args={}){return this.call('action',name,args);}
 invalidate(urgent=false,change=null){
  if(this.closed)return;
  if(urgent){clearTimeout(this.invalidationTimer);this.invalidationTimer=null;this.pendingInvalidations=[];for(const refresh of this.watchers)refresh(true);return;}
  (this.pendingInvalidations ||= []).push(change);
  if(this.invalidationTimer!=null)return;
  this.invalidationTimer=setTimeout(()=>{
   this.invalidationTimer=null;const changes=this.pendingInvalidations;this.pendingInvalidations=[];
   for(const refresh of this.watchers)if(changes.some(c=>this.affects(refresh,c)))refresh();
  },40);
 }
 affects(refresh,change){
  if(!Array.isArray(change?.collections)||!change.collections.length)return true;
  const ephemeral={cursors:'collaboration:cursors',boardPresence:'collaboration:activeUsers',editors:'collaboration:editors'};
  if(change.collections.every(c=>ephemeral[c])){
   if(refresh.boardId&&Array.isArray(change.boards)&&change.boards.length&&!change.boards.includes(refresh.boardId))return false;
   return change.collections.some(c=>ephemeral[c]===String(refresh.queryName));
  }
  // Use the collections actually read by this query, including authorization reads.
  // Unknown/older servers remain conservative. Membership changes are always broad.
  const permissions=['boards','boardMembers','linkMembers','teamMembers','teams','inviteLinks','sessions','users'];
  if(!change.collections.some(c=>permissions.includes(c))&&Array.isArray(refresh.dependencies)&&refresh.dependencies.length&&!refresh.dependencies.includes('*')){
   return change.collections.some(c=>refresh.dependencies.includes(c));
  }
  return true;
 }
 onUpdate(name,args,callback,onError){
  const key=this.epoch+':'+String(name)+':'+JSON.stringify(encode(args));
  let entry=this.subscriptions.get(key);
  if(!entry){
   entry={listeners:new Set(),hasValue:false,value:undefined};this.subscriptions.set(key,entry);
   let stopped=false,running=false,again=false,last,version=-1,controller,request=0,started=0,lastRefresh=0;
   const refresh=async(urgent=false)=>{
    if(stopped||document.hidden&&entry.hasValue)return;
    if(running){if(!urgent||Date.now()-started<1500){again=true;return;}controller.abort();}
    running=true;again=false;started=Date.now();const current=++request,epoch=this.epoch;
    controller=new AbortController();const activeController=controller,signal=controller.signal;const timeout=setTimeout(()=>activeController.abort(),15000);
    try{let dependencies;const value=await this.call('query',name,args,signal,value=>{dependencies=value;});const fingerprint=JSON.stringify(encode(value));
     if(!stopped&&current===request&&epoch===this.epoch){refresh.dependencies=dependencies;lastRefresh=Date.now();if(fingerprint!==last||epoch!==version){last=fingerprint;version=epoch;entry.value=value;entry.hasValue=true;for(const listener of entry.listeners)listener.callback(value);}}
    }catch(error){if(!stopped&&current===request&&epoch===this.epoch&&!signal.aborted&&!error.retryable)for(const listener of entry.listeners)listener.onError?.(error);}
    finally{clearTimeout(timeout);if(current===request){running=false;if(again&&!stopped){again=false;queueMicrotask(()=>refresh());}}}
   };
   refresh.queryName=name;refresh.boardId=args?.boardId;
   this.watchers.add(refresh);
   // Realtime drives updates; polling is recovery and capability revalidation only.
   const interval=setInterval(()=>{if(!document.hidden&&Date.now()-lastRefresh>=(args?.token?1000:this.realtimeReady&&this.online?30000:3000))refresh();},1000);
   entry.stop=()=>{stopped=true;request++;controller?.abort();clearInterval(interval);this.watchers.delete(refresh);this.subscriptions.delete(key);};
   queueMicrotask(()=>refresh());
  }
  const listener={callback,onError};entry.listeners.add(listener);
  if(entry.hasValue)callback(entry.value);
  return()=>{entry.listeners.delete(listener);if(!entry.listeners.size)entry.stop();};
 }
 async auth(action,args){const r=await fetch('/api/backend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({auth:action,args})});const result=await r.json();if(!r.ok)throw Error(result.error||'Could not sign in');if(result.session){const {error}=await this.supabase.auth.setSession(result.session);if(error)throw error;}return result;}
 async signOut(){const {error}=await this.supabase.auth.signOut();if(error)throw error;}
 close(){this.closed=true;clearTimeout(this.invalidationTimer);this.authSubscription?.unsubscribe();document.removeEventListener('visibilitychange',this.resume);window.removeEventListener('online',this.resume);window.removeEventListener('pageshow',this.resume);for(const entry of [...this.subscriptions.values()])entry.stop();if(this.channel)this.supabase.removeChannel(this.channel);this.channel=null;this.watchers.clear();}
}
