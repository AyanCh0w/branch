import {it,expect,vi} from 'vitest';
import {LiveRoomCore} from '../live-room';
import {Engine} from '../engine';
import {Store} from '../store';
function setup(){
 const sockets:any[]=[],storage=new Map();let tx='committed';
 const state={storage:{get:async(k:string)=>storage.get(k),put:async(k:string,v:any)=>storage.set(k,v),delete:async(k:string)=>storage.delete(k)},blockConcurrencyWhile:async(fn:any)=>fn(),getWebSockets:()=>sockets.filter(s=>!s.closed),acceptWebSocket:(s:any)=>sockets.push(s)};
 const authorize=vi.fn(async(_board:string,m:any)=>{if(m.accessToken==='denied')throw Error('No access');return {userId:m.accessToken,role:m.accessToken==='viewer'?'viewer':'editor',name:'Server name',color:'#123456',expiresAt:Date.now()+45000};});
 const room=new LiveRoomCore(state,authorize,async()=>tx);
 const socket=()=>{let data:any;const s:any={messages:[],closed:false,serializeAttachment:(v:any)=>{data=structuredClone(v);},deserializeAttachment:()=>structuredClone(data),send:(v:string)=>s.messages.push(JSON.parse(v)),close:()=>{s.closed=true;}};room.accept(s,'board');return s;};
 const auth=(s:any,user:string)=>room.message(s,JSON.stringify({type:'auth',accessToken:user,tabId:user,token:''}));
 return {room,socket,auth,authorize,storage,transaction:(v:string)=>tx=v};
}
it('streams each cursor and character immediately, without database writes or per-message authorization',async()=>{
 const h=setup(),a=h.socket(),b=h.socket();await h.auth(a,'alice');await h.auth(b,'bob');
 for(const text of ['h','he','hel','hell','hello'])await h.room.message(a,JSON.stringify({type:'text',nodeKey:'node',field:'body',text,epoch:0,userId:'spoof'}));
 for(let x=0;x<30;x++)await h.room.message(a,JSON.stringify({type:'cursor',position:{x,y:2},name:'spoof'}));
 expect(b.messages.filter((m:any)=>m.type==='text').map((m:any)=>m.text)).toEqual(['h','he','hel','hell','hello']);
 expect(b.messages.filter((m:any)=>m.type==='cursor')).toHaveLength(30);expect(h.authorize).toHaveBeenCalledTimes(2);
 expect(b.messages.at(-1).name).toBe('Server name');expect(b.messages.at(-1).userId).toBe('alice');
 expect(h.storage.size).toBe(0);
});
it('unauthenticated, expired and view-only clients cannot publish text; viewers can point',async()=>{
 const h=setup(),a=h.socket(),viewer=h.socket(),stranger=h.socket();await h.auth(a,'alice');await h.auth(viewer,'viewer');
 const text=JSON.stringify({type:'text',nodeKey:'node',field:'draft',epoch:0,text:'no'});
 await h.room.message(viewer,text);await h.room.message(stranger,text);expect(stranger.closed).toBe(true);expect(a.messages.filter((m:any)=>!['ready','presence'].includes(m.type))).toHaveLength(0);
 await h.room.message(viewer,JSON.stringify({type:'cursor',position:{x:1,y:2}}));expect(a.messages.at(-1).type).toBe('cursor');
 const old=viewer.deserializeAttachment();viewer.serializeAttachment({...old,expiresAt:Date.now()-1});await h.room.message(viewer,text);expect(viewer.closed).toBe(true);
});
it('permission barrier closes peers before commit and rejects reconnects until transaction ends',async()=>{
 const h=setup(),a=h.socket();await h.auth(a,'alice');h.transaction('in progress');await h.room.pause('123');expect(a.closed).toBe(true);expect(h.storage.get('paused')).toBe('123');
 const b=h.socket();await h.auth(b,'bob');expect(b.closed).toBe(true);
 h.transaction('committed');const denied=h.socket();await h.auth(denied,'denied');expect(denied.closed).toBe(true);
 const owner=h.socket();await h.auth(owner,'owner');expect(owner.closed).toBe(false);expect(owner.messages.some((m:any)=>m.type==='ready')).toBe(true);
});
it('an access check already in flight cannot resurrect a socket across revocation',async()=>{
 const h=setup(),s=h.socket();let resolve:any;h.authorize.mockImplementationOnce(()=>new Promise(r=>resolve=r));const authenticating=h.auth(s,'alice');
 await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));await h.room.pause('124');resolve({userId:'alice',role:'editor',expiresAt:Date.now()+45000});await authenticating;
 expect(s.closed).toBe(true);expect(s.messages).toEqual([]);
});
it('aborted changes allow a fresh access check; unknown transactions remain closed',async()=>{
 const h=setup();await h.room.pause('125');h.transaction('unknown');expect(await h.room.available()).toBe(false);h.transaction('aborted');expect(await h.room.available()).toBe(true);
});
it('large, malformed and out-of-bounds interaction data are rejected',async()=>{
 const h=setup(),a=h.socket(),b=h.socket();await h.auth(a,'alice');await h.auth(b,'bob');
 await h.room.message(a,JSON.stringify({type:'cursor',position:{x:1e30,y:0}}));await h.room.message(a,JSON.stringify({type:'text',nodeKey:'node',field:'draft',epoch:-1,text:'invalid'}));expect(b.messages.filter((m:any)=>!['ready','presence'].includes(m.type))).toHaveLength(0);
 await h.room.message(a,'x'.repeat(70001));expect(a.closed).toBe(true);
});
it('access barriers include inherited team rooms and fail closed when the relay fails',async()=>{
 const sql={query:vi.fn(async(q:string)=>({rows:q.includes('pg_current')?[{xid:'88'}]:[{id:'inherited'}]}))};const db=new Store(sql,true);db.touch('teamMembers','member',{teamId:'team',userId:'person'});
 const barrier=vi.fn(async()=>{throw Error('unavailable');});const engine=new Engine({},undefined,undefined,undefined,barrier);
 await expect(engine.barrier(db)).rejects.toThrow('unavailable');expect(barrier).toHaveBeenCalledWith(['inherited'],'88');
 const cursor=new Store(sql,true);cursor.touch('cursors','cursor',{boardId:'board'});await engine.barrier(cursor);expect(barrier).toHaveBeenCalledTimes(1);
});

it('real membership changes pause delivery before SQL commit; failed barriers roll back access',async()=>{
 const {harness}=await import('./harness');const h=await harness();
 try{
  const owner=await h.account('owner'),member=await h.account('member');const boardId=await h.call(owner,'library:create',{title:'Live security'});
  const db=new Store(h.pool,true);const grant=await db.insert('boardMembers',{boardId,userId:member.userId,role:'editor'});
  const calls:any[]=[];h.engine.accessBarrier=async(boards,xid)=>{calls.push({boards,xid});expect((await h.pool.query('select pg_xact_status($1::xid8) as status',[xid])).rows[0].status).toBe('in progress');throw Error('Relay unavailable');};
  // This test mutation uses the same transaction/Store path as production handlers.
  const {mutation}=await import('../definitions');h.engine.functions={...h.engine.functions,probe:{revoke:mutation({args:{},handler:async ctx=>ctx.db.delete(grant)})}};
  await expect(h.call(owner,'probe:revoke')).rejects.toThrow('Relay unavailable');expect(calls[0].boards).toContain(boardId);
  expect(await h.call(member,'library:permission',{boardId,token:''},'query')).toMatchObject({role:'editor'});
  h.engine.accessBarrier=async()=>{};await h.call(owner,'probe:revoke');expect(await h.call(member,'library:permission',{boardId,token:''},'query')).toBeNull();
 }finally{await h.close();}
});
it('ordinary board title and timestamp changes do not interrupt the live room',async()=>{
 const sql={query:vi.fn(async(q:string)=>({rows:q.startsWith('select')?[{id:'board',collection:'boards',data:{title:'Old',ownerId:'owner',initialized:true,development:false}}]:[]}))};const db=new Store(sql,true);
 await db.patch('board',{title:'New',updatedAt:Date.now()});expect(db.accessChanged).toBe(false);
 await db.patch('board',{archived:true});expect(db.accessChanged).toBe(true);
});
it('bootstrap returns the board in one read and denies outsiders without exposing content',async()=>{
 const {harness}=await import('./harness');const h=await harness();try{const owner=await h.account('owner'),stranger=await h.account('stranger');const boardId=await h.call(owner,'library:create',{title:'Private'});
 expect(await h.call(owner,'boards:open',{boardId,token:''},'query')).toMatchObject({title:'Private',role:'owner',nodes:[]});expect(await h.call(stranger,'boards:open',{boardId,token:''},'query')).toBeNull();
 }finally{await h.close();}
});
it('pushes presence on join, visibility and disconnect, with server-derived identities',async()=>{
 const h=setup(),a=h.socket(),b=h.socket();await h.auth(a,'alice');await h.auth(b,'bob');
 expect(a.messages.at(-1).users.map((u:any)=>u.userId)).toEqual(['alice','bob']);
 await h.room.message(b,JSON.stringify({type:'visibility',visible:false,userId:'spoof'}));expect(a.messages.at(-1).users.map((u:any)=>u.userId)).toEqual(['alice']);
 await h.room.message(b,JSON.stringify({type:'visibility',visible:true}));expect(a.messages.at(-1).users).toHaveLength(2);
 b.closed=true;h.room.closed(b);expect(a.messages.at(-1).users.map((u:any)=>u.userId)).toEqual(['alice']);expect(h.authorize).toHaveBeenCalledTimes(2);
});
it('relays bounded geometry only for editors without any write or extra authorization',async()=>{
 const h=setup(),a=h.socket(),b=h.socket(),viewer=h.socket();await h.auth(a,'alice');await h.auth(b,'bob');await h.auth(viewer,'viewer');
 const nodes=[{id:'note',x:30,y:40,width:450,minHeight:200,body:'must not relay'}];
 await h.room.message(a,JSON.stringify({type:'geometry',nodes}));expect(b.messages.at(-1).nodes).toEqual([{id:'note',x:30,y:40,width:450,minHeight:200}]);
 const count=b.messages.length;
 await h.room.message(viewer,JSON.stringify({type:'geometry',nodes}));await h.room.message(a,JSON.stringify({type:'geometry',nodes:[{id:'note',x:1e20}]}));
 expect(b.messages.length).toBe(count);expect(h.authorize).toHaveBeenCalledTimes(3);expect(h.storage.size).toBe(0);
});
it('sends committed notifications after commit and never retries a committed write when delivery fails',async()=>{
 const {harness}=await import('./harness');const h=await harness();try{
  const owner=await h.account('notify');let notifications=0;h.engine.notifyChanges=async change=>{
   notifications++;const {rows}=await h.pool.query('select id from branch_private.records where id=$1',[change.boards[0]]);expect(rows).toHaveLength(1);throw Error('room unavailable');
  };
  const boardId=await h.call(owner,'library:create',{title:'Post-commit notification'});expect(boardId).toBeTruthy();expect(notifications).toBe(1);
  expect((await h.call(owner,'library:list',{},'query')).filter((b:any)=>b.title==='Post-commit notification')).toHaveLength(1);
 }finally{await h.close();}
});
it('client messages cannot forge database notifications or deliver anything through an access barrier',async()=>{
 const h=setup(),a=h.socket(),b=h.socket();await h.auth(a,'alice');await h.auth(b,'bob');const count=b.messages.length;
 await h.room.message(a,JSON.stringify({type:'revision',change:{collections:['nodes'],boards:['board']}}));expect(b.messages.length).toBe(count);
 h.room.changed({collections:['nodes'],boards:['board']});expect(b.messages.at(-1).type).toBe('revision');
 await h.room.pause('1234');const before=b.messages.length;h.room.changed({collections:['nodes'],boards:['board']});expect(b.messages.length).toBe(before);
});
