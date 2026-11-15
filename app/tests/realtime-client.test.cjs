const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync('backend/browser.js','utf8').replace(/^import .*;$/m,'').replaceAll('export ','')+'\nBranchClient';
const wait=()=>new Promise(r=>setTimeout(r,70));
function setup(){
 const document=new EventTarget();document.hidden=false;const window=new EventTarget();let authCallback,channels=0,removed=0,queries=0,now=Date.now(),connected=true;
 const channelList=[];const realtime={setAuth:async()=>{},isConnected:()=>connected,connect:()=>{connected=true;}};
 const supabase={auth:{onAuthStateChange:cb=>{authCallback=cb;return {data:{subscription:{unsubscribe(){}}}};},getSession:async()=>({data:{session:null}})},realtime,
 removeChannel:async()=>{removed++;},channel:()=>{channels++;const callbacks={};const c={on(type,filter,fn){callbacks[type]=fn;return c;},subscribe(fn){c.status=fn;queueMicrotask(()=>fn('SUBSCRIBED'));return c;},change:()=>callbacks.postgres_changes()};channelList.push(c);return c;}};
 let fetcher=async()=>({ok:true,json:async()=>({value:{revision:queries}})});
 const Client=vm.runInNewContext(script,{createClient:()=>supabase,document,window,Worker:function(){},fetch:(...args)=>{queries++;return fetcher(...args);},AbortSignal,AbortController,queueMicrotask,setTimeout,clearTimeout,setInterval,clearInterval,Date:class extends Date{static now(){return now;}},btoa,atob,TextEncoder,Uint8Array,ArrayBuffer});
 const client=new Client({url:'test',publishableKey:'test'});
 const session=(id='one',token='token')=>({user:{id},access_token:token});
 return {client,document,window,emit:(s=session())=>authCallback('SIGNED_IN',s),session,stats:()=>({channels,removed,queries}),channelList,setFetch:fn=>fetcher=fn,advance:ms=>now+=ms};
}
test('tab refocus preserves identity, mounted queries and the existing realtime channel',async()=>{
 const h=setup();try{await wait();h.emit();await wait();let calls=0;const off=h.client.onUpdate('boards:read',{boardId:'board'},()=>calls++);await wait();const epoch=h.client.epoch,stats=h.stats();h.emit();h.document.dispatchEvent(new Event('visibilitychange'));await wait();assert.equal(h.client.epoch,epoch);assert.equal(h.stats().channels,stats.channels);assert.equal(h.stats().removed,stats.removed);assert.ok(calls>=1);off();}finally{h.client.close();}
});
test('token refresh preserves subscriptions while account changes invalidate their identity',async()=>{
 const h=setup();try{await wait();h.emit();await wait();const epoch=h.client.epoch,channels=h.stats().channels;h.emit(h.session('one','new-token'));await wait();assert.equal(h.client.epoch,epoch);assert.equal(h.stats().channels,channels);h.emit(h.session('two','other-token'));await wait();assert.equal(h.client.epoch,epoch+1);assert.equal(h.stats().channels,channels+1);assert.equal(h.stats().removed,1);}finally{h.client.close();}
});
test('identical subscribers share one read and revision events push updates without a poll',async()=>{
 const h=setup();try{await wait();h.emit();await wait();let a=0,b=0;const start=h.stats().queries;const offA=h.client.onUpdate('boards:read',{boardId:'board'},()=>a++),offB=h.client.onUpdate('boards:read',{boardId:'board'},()=>b++);await wait();assert.equal(h.stats().queries-start,1);h.channelList.at(-1).change();await wait();assert.equal(a,2);assert.equal(b,2);assert.equal(h.stats().queries-start,2);offA();offB();assert.equal(h.client.watchers.size,0);}finally{h.client.close();}
});
test('returning to a tab replaces a stalled read and ignores its obsolete response',async()=>{
 const h=setup();try{await wait();h.emit();await wait();let resolveOld,received=[];h.setFetch(()=>new Promise(r=>resolveOld=r));h.client.onUpdate('boards:read',{boardId:'board'},v=>received.push(v.revision));await wait();h.advance(2000);h.setFetch(async()=>({ok:true,json:async()=>({value:{revision:'fresh'}})}));h.document.dispatchEvent(new Event('visibilitychange'));await wait();resolveOld({ok:true,json:async()=>({value:{revision:'stale'}})});await wait();assert.deepEqual(received,['fresh']);}finally{h.client.close();}
});
