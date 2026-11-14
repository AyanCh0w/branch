import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import * as Y from 'yjs';
import {harness} from './harness';
import {Store} from '../store';
import {encode,decode} from '../codec';
import {expireJobs} from '../jobs';
let h:any,owner:any,editor:any,stranger:any,boardId:string;
const scope=()=>({boardId,token:''});
beforeAll(async()=>{h=await harness();owner=await h.account('owner');editor=await h.account('editor');stranger=await h.account('stranger');boardId=await h.call(owner,'library:create',{title:'Migration test'});await new Store(h.pool,true).patch(boardId,{initialized:false});});
afterAll(()=>h?.close());
describe('Supabase/Postgres migration',()=>{
 it('keeps profiles private and resolves usernames',async()=>{const me=await h.call(owner,'accounts:me',{},'query');expect(me.username).toBe('owner');expect(await h.call({},'accounts:me',{},'query')).toBeNull();});
 it('denies direct browser SQL access to application records',async()=>{await h.pg.exec('set role anon');try{await expect(h.pg.query('select * from branch_private.records')).rejects.toThrow();await expect(h.pg.query('select * from public.branch_revisions')).rejects.toThrow();}finally{await h.pg.exec('reset role');}});
 it('prevents public invocation of internal functions',async()=>{await expect(h.call(owner,'chat:append',{runId:'anything',text:'bad'})).rejects.toThrow('Unknown operation');});
 it('validates operation arguments',async()=>{await expect(h.call(owner,'library:create',{title:42})).rejects.toThrow('expected string');await expect(h.call(owner,'library:create',{title:'x',ownerId:stranger.userId})).rejects.toThrow('Unexpected');});
 it('rejects IDs from the wrong collection before a handler runs',async()=>{await expect(h.call(owner,'sharing:removeMember',{memberId:boardId})).rejects.toThrow('expected boardMembers ID');expect(await new Store(h.pool).get(boardId)).toBeTruthy();});
 it('denies other accounts and anonymous access',async()=>{await expect(h.call(stranger,'boards:read',scope(),'query')).rejects.toThrow();await expect(h.call({},'boards:read',scope(),'query')).rejects.toThrow();});
 it('rolls back all changes when a mutation fails',async()=>{const before=await h.pool.query('select count(*) from branch_private.records');await expect(h.call(owner,'boards:initialize',{...scope(),title:'bad',nodes:[{id:'duplicate',type:'plan'},{id:'duplicate',type:'plan'}]})).rejects.toThrow();const after=await h.pool.query('select count(*) from branch_private.records');expect(after.rows).toEqual(before.rows);});
 it('preserves Yjs bytes through Postgres storage and JSON wire encoding',async()=>{const doc=new Y.Doc();doc.getText('body').insert(0,'Shared text');const state=Uint8Array.from(Y.encodeStateAsUpdate(doc)).buffer;const roundtrip=decode(encode({state}));expect(new Uint8Array(roundtrip.state)).toEqual(new Uint8Array(state));const result=new Y.Doc();Y.applyUpdate(result,new Uint8Array(roundtrip.state));expect(result.getText('body').toString()).toBe('Shared text');});
 it('creates a board and reads the initialized canvas',async()=>{await h.call(owner,'boards:initialize',{...scope(),title:'Migration test',nodes:[{id:'note1',type:'plan',title:'Brief',body:'hello',x:0,y:0,width:300,contexts:[]},{id:'chat1',type:'thread',title:'Chat',draft:'hello',x:400,y:0,width:300,contexts:[],messages:[]}]});const b=await h.call(owner,'boards:read',scope(),'query');expect(b.nodes).toHaveLength(2);expect(b.nodes.find((n:any)=>n.id==='note1').body).toBe('hello');});
 it('does not expose revisions to another authenticated user',async()=>{await h.pg.exec('set role authenticated');try{expect((await h.pg.query('select * from public.branch_revisions')).rows).toHaveLength(0);}finally{await h.pg.exec('reset role');}});
 it('queues AI atomically and makes Send idempotent',async()=>{const b=await h.call(owner,'boards:read',scope(),'query');const chat=b.nodes.find((n:any)=>n.id==='chat1');const args={...scope(),nodeKey:'chat1',requestId:'request-1',expectedVersion:chat.sharedVersion};const id=await h.call(owner,'chat:send',args);expect(await h.call(owner,'chat:send',args)).toBe(id);expect((await h.pool.query('select * from branch_private.jobs')).rows).toHaveLength(1);const run=await new Store(h.pool).get(id);expect(run.billedUserId).toBe(owner.userId);expect(run.input.messages.at(-1).content).toBe('hello');});
 it('clears generation state on cancellation',async()=>{await h.call(owner,'chat:stop',{...scope(),nodeKey:'chat1'});const b=await h.call(owner,'boards:read',scope(),'query');expect(b.nodes.find((n:any)=>n.id==='chat1').activeRun).toBeFalsy();});
});

describe('collaboration and permission parity',()=>{
 let memberId:string,linkId:string,guest:any;
 it('enforces viewer permissions',async()=>{await h.call(owner,'sharing:addMember',{boardId,username:'editor',role:'viewer'});expect((await h.call(editor,'boards:read',scope(),'query')).role).toBe('viewer');await expect(h.call(editor,'collaboration:focus',{...scope(),nodeKey:'note1',field:'body',tabId:'tab2'})).rejects.toThrow('denied');const rows=await new Store(h.pool).query('boardMembers').withIndex('board_user',(q:any)=>q.eq('boardId',boardId).eq('userId',editor.userId)).collect();memberId=rows[0]._id;await h.call(owner,'sharing:changeMemberRole',{memberId,role:'editor'});});
 it('merges concurrent Yjs body edits',async()=>{const b=await h.call(owner,'boards:read',scope(),'query'),n=b.nodes.find((n:any)=>n.id==='note1');const a=new Y.Doc(),c=new Y.Doc();Y.applyUpdate(a,new Uint8Array(n.sharedTextState));Y.applyUpdate(c,new Uint8Array(n.sharedTextState));const av=Y.encodeStateVector(a),cv=Y.encodeStateVector(c);a.getText('body').insert(0,'A ');c.getText('body').insert(0,'B ');await Promise.all([h.call(owner,'collaboration:updateText',{...scope(),nodeKey:'note1',update:Uint8Array.from(Y.encodeStateAsUpdate(a,av)).buffer,tabId:'tab1',epoch:0}),h.call(editor,'collaboration:updateText',{...scope(),nodeKey:'note1',update:Uint8Array.from(Y.encodeStateAsUpdate(c,cv)).buffer,tabId:'tab2',epoch:0})]);const after=await h.call(owner,'boards:read',scope(),'query');expect(after.nodes.find((n:any)=>n.id==='note1').body).toContain('A ');expect(after.nodes.find((n:any)=>n.id==='note1').body).toContain('B ');});
 it('blocks Send while a different person edits',async()=>{await h.call(editor,'collaboration:focus',{...scope(),nodeKey:'chat1',field:'title',tabId:'tab2'});await expect(h.call(owner,'chat:send',{...scope(),nodeKey:'chat1',expectedVersion:0,requestId:'blocked-send'})).rejects.toThrow('Someone else');await h.call(editor,'collaboration:release',{...scope(),nodeKey:'chat1',tabId:'tab2'});});
 it('checks stale draft versions before Send',async()=>{await expect(h.call(owner,'chat:send',{...scope(),nodeKey:'chat1',expectedVersion:-1,requestId:'stale-send'})).rejects.toThrow('draft changed');});
 it('revokes existing guest sessions with their invite',async()=>{const linkToken='a'.repeat(64);linkId=await h.call(owner,'sharing:createLink',{boardId,role:'viewer',label:'Guest',linkToken});guest=await h.call({},'sharing:joinGuest',{linkToken,name:'Guest',sessionToken:'b'.repeat(64)});expect((await h.call({},'boards:read',{boardId,token:'b'.repeat(64)},'query')).role).toBe('viewer');await h.call(owner,'sharing:revokeLink',{linkId});await expect(h.call({},'boards:read',{boardId,token:'b'.repeat(64)},'query')).rejects.toThrow();});
 it('removes direct access immediately',async()=>{await h.call(owner,'sharing:removeMember',{memberId});await expect(h.call(editor,'boards:read',scope(),'query')).rejects.toThrow();});
 it('preserves board ownership through team membership changes',async()=>{const teamId=await h.call(owner,'teams:create',{name:'Team'});await h.call(owner,'teams:addMember',{teamId,username:'editor'});await h.call(owner,'teams:moveBoard',{boardId,teamId});expect((await h.call(editor,'boards:read',scope(),'query')).role).toBe('editor');await h.call(owner,'teams:remove',{teamId,confirmation:'Team'});expect((await h.call(owner,'boards:read',scope(),'query')).role).toBe('owner');await expect(h.call(editor,'boards:read',scope(),'query')).rejects.toThrow();});
 it('preserves deletion/restore semantics',async()=>{await h.call(owner,'boards:deleteNode',{...scope(),nodeKey:'note1',operationId:'delete-1'});expect((await h.call(owner,'boards:read',scope(),'query')).nodes.some((n:any)=>n.id==='note1')).toBe(false);await h.call(owner,'boards:restoreNode',{...scope(),nodeKey:'note1',operationId:'delete-1'});expect((await h.call(owner,'boards:read',scope(),'query')).nodes.some((n:any)=>n.id==='note1')).toBe(true);});
 it('binds uploaded storage IDs to their exact board and upload ticket',async()=>{const ticket=await h.call(owner,'files:uploadUrl',scope());const fake=await new Store(h.pool,true).insert('_storage',{path:'other/file',size:10,contentType:'image/png',ticket:'not-this-ticket',boardId,userId:owner.userId});await expect(h.call(owner,'files:finish',{...scope(),ticket:ticket.ticket,storageId:fake})).rejects.toThrow('Invalid file');await expect(h.call(stranger,'files:read',{...scope(),storageId:fake},'query')).rejects.toThrow();});
});


describe('durable generation recovery',()=>{
 it('fails an expired job and clears its active run atomically without replaying AI',async()=>{
  const board=await h.call(owner,'library:create',{title:'Worker recovery'});
  const db=new Store(h.pool,true);await db.patch(board,{initialized:false});
  await h.call(owner,'boards:initialize',{boardId:board,token:'',title:'Worker recovery',nodes:[{id:'chat',type:'thread',title:'Chat',draft:'Hello',x:0,y:0,width:300,contexts:[],messages:[]}]});
  const read=await h.call(owner,'boards:read',{boardId:board,token:''},'query');
  const runId=await h.call(owner,'chat:send',{boardId:board,token:'',nodeKey:'chat',expectedVersion:read.nodes[0].sharedVersion,requestId:'recover-job'});
  await h.engine.call('chat:append',{runId,text:'Partial response'},{},'mutation',true);
  await h.pool.query("update branch_private.jobs set status='running',lease_until=now()-interval '1 minute' where args->>'runId'=$1",[runId]);
  expect(await expireJobs(h.engine)).toBe(1);
  const after=await h.call(owner,'boards:read',{boardId:board,token:''},'query');
  expect(after.nodes[0].activeRun).toBeFalsy();
  expect(after.nodes[0].messages.at(-1).text).toBe('Partial response');
  expect((await db.get(runId)).status).toBe('failed');
  expect(await expireJobs(h.engine)).toBe(0);
 });
});
