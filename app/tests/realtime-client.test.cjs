const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync('backend/browser.js','utf8').replace(/^import .*;$/m,'').replaceAll('export ','')+'\nBranchClient';
const wait=()=>new Promise(r=>setTimeout(r,70));
function setup(){
 const document=new EventTarget();document.hidden=false;const window=new EventTarget();let authCallback,channels=0,removed=0,queries=0,now=Date.now(),connected=true;
 const channelList=[];const realtime={setAuth:async()=>{},isConnected:()=>connected,connect:()=>{connected=true;}};
 const supabase={auth:{onAuthStateChange:cb=>{authCallback=cb;return {data:{subscription:{unsubscribe(){}}}};},getSession:async()=>({data:{session:null}})},realtime,
 removeChannel:async()=>{removed++;},channel:()=>{channels++;const callbacks={};const c={on(type,filter,fn){callbacks[type]=fn;return c;},subscribe(fn){c.status=fn;queueMicrotask(()=>fn('SUBSCRIBED'));return c;},change:(change)=>callbacks.postgres_changes({new:{change}})};channelList.push(c);return c;}};
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

test('presence events refresh only their board presence query, not content or other boards',async()=>{
 const h=setup();try{await wait();h.emit();await wait();const counts={};
 for(const [name,boardId]of [['boards:read','one'],['accounts:me',undefined],['collaboration:cursors','one'],['collaboration:editors','one'],['collaboration:cursors','two']])h.client.onUpdate(name,{boardId},()=>{const key=name+boardId;counts[key]=(counts[key]||0)+1;});
 await wait();const initial=h.stats().queries;
 h.channelList.at(-1).change({collections:['cursors'],boards:['one']});await wait();
 assert.equal(h.stats().queries-initial,1);assert.equal(counts['collaboration:cursorsone'],2);assert.equal(counts['boards:readone'],1);assert.equal(counts['collaboration:cursorstwo'],1);
 h.channelList.at(-1).change({collections:['boardMembers'],boards:['one']});await wait();assert.equal(counts['boards:readone'],2);assert.equal(counts['accounts:meundefined'],2);
 }finally{h.client.close();}
});
test('coalesced content and presence events cannot lose a content update',async()=>{
 const h=setup();try{await wait();h.emit();await wait();let calls=0;h.client.onUpdate('boards:read',{boardId:'board'},()=>calls++);await wait();
 h.channelList.at(-1).change({collections:['nodes'],boards:['board']});h.channelList.at(-1).change({collections:['editors'],boards:['board']});await wait();assert.equal(calls,2);
 }finally{h.client.close();}
});
test('hidden tabs pause repeated reads and catch up immediately when shown',async()=>{
 const h=setup();try{await wait();h.emit();await wait();let calls=0;h.client.onUpdate('boards:read',{boardId:'board'},()=>calls++);await wait();h.document.hidden=true;
 h.channelList.at(-1).change();await wait();assert.equal(calls,1);h.document.hidden=false;h.document.dispatchEvent(new Event('visibilitychange'));await wait();assert.equal(calls,2);
 }finally{h.client.close();}
});

test('temporary service failures do not masquerade as revoked board access',async()=>{
 const h=setup();try{await wait();h.emit();await wait();let errors=0,values=0;
 h.setFetch(async()=>({ok:false,status:503,json:async()=>({error:'Temporarily unavailable'})}));
 h.client.onUpdate('boards:read',{boardId:'board'},()=>values++,()=>errors++);await wait();assert.equal(errors,0);assert.equal(h.client.online,false);
 h.setFetch(async()=>({ok:true,json:async()=>({value:{revision:'recovered'}})}));h.document.dispatchEvent(new Event('visibilitychange'));await wait();assert.equal(values,1);assert.equal(h.client.online,true);
 h.setFetch(async()=>({ok:false,status:403,json:async()=>({error:'Board access revoked'})}));h.channelList.at(-1).change();await wait();assert.equal(errors,1);
 }finally{h.client.close();}
});

test('content notifications refresh actual read dependencies while permission changes revalidate all queries',async()=>{
 const h=setup();try{await wait();h.emit();await wait();const calls={};
 h.setFetch(async(_url,request)=>{const {name}=JSON.parse(request.body);calls[name]=(calls[name]||0)+1;return {ok:true,json:async()=>({value:{revision:calls[name]},dependencies:name==='boards:read'?['boards','nodes','users']:['chatgptConnections']})};});
 h.client.onUpdate('boards:read',{boardId:'board'},()=>{});h.client.onUpdate('chatgpt:status',{},()=>{});await wait();
 h.channelList.at(-1).change({collections:['nodes'],boards:['board']});await wait();assert.equal(calls['boards:read'],2);assert.equal(calls['chatgpt:status'],1);
 h.channelList.at(-1).change({collections:['boardMembers'],boards:['board']});await wait();assert.equal(calls['boards:read'],3);assert.equal(calls['chatgpt:status'],2);
 }finally{h.client.close();}
});

test('bootstrap subscribers share the same read regardless of argument property order',async()=>{
 const h=setup();try{await wait();h.emit();await wait();const initial=h.stats().queries;
 h.client.onUpdate('boards:open',{boardId:'board',token:''},()=>{});h.client.onUpdate('boards:open',{token:'',boardId:'board'},()=>{});await wait();assert.equal(h.stats().queries-initial,1);
 }finally{h.client.close();}
});
