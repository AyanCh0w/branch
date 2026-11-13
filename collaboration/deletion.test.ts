import {convexTest} from 'convex-test';
import {it,expect,vi,afterEach} from 'vitest';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.ts');
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
async function setup(){
 vi.stubEnv('DEV_BRIDGE_SECRET','deletion-test');vi.stubEnv('ENABLE_DEVELOPMENT_BRIDGE','true');
 const t=convexTest(schema,modules);
 const a=await t.mutation(api.boards.developmentSession,{secret:'deletion-test',identityKey:'alice',token:'alice'});
 await t.mutation(api.boards.developmentSession,{secret:'deletion-test',identityKey:'bob',token:'bob',boardId:a.boardId});
 const auth={token:'alice',boardId:a.boardId},bob={...auth,token:'bob'};
 const context={id:'edge',source:'source',body:'Frozen excerpt',quote:'Excerpt',cutoff:'message-1',inherited:[{source:'upstream',body:'Frozen upstream'}],attachment:{asset:'local-file'}};
 await t.mutation(api.boards.initialize,{...auth,title:'Undo',nodes:[
  {id:'source',type:'thread',title:'Original',body:'Notes',draft:'Unsent prompt',messages:[{id:'message-1',role:'assistant',text:'Original reply'}],contexts:[{id:'incoming',source:'upstream',body:'Upstream'}],x:123,y:456,width:610},
  {id:'target',type:'thread',title:'Target',contexts:[context],messages:[],x:700,y:0},
  {id:'upstream',type:'upload',title:'File',asset:'local-file',text:'File contents',x:0,y:0}
 ]});
 return {t,auth,bob,context};
}
it('restores full canonical card and both connection directions without reverting concurrent changes; supports redo',async()=>{
 const {t,auth,bob,context}=await setup();
 const before=(await t.query(api.boards.read,auth)).nodes.find(n=>n.id==='source')!;
 const action={...auth,nodeKey:'source',operationId:'delete-1'};
 await t.mutation(api.boards.deleteNode,action);
 let board=await t.query(api.boards.read,auth);
 expect(board.nodes.map(n=>n.id)).not.toContain('source');expect(board.nodes.find(n=>n.id==='target')!.contexts).toEqual([]);
 const added={id:'new-edge',source:'upstream',body:'New connection'};
 await t.mutation(api.boards.patchNodes,{...bob,changes:[{id:'target',patch:{x:999,contexts:[added]}}]});
 await t.mutation(api.boards.restoreNode,action);
 board=await t.query(api.boards.read,auth);
 const restored=board.nodes.find(n=>n.id==='source')!;
 for(const key of ['x','y','width','title','body','draft','messages','contexts','sharedTextState','sharedVersion'])expect(restored[key]).toEqual(before[key]);
 expect(board.nodes.find(n=>n.id==='target')!.contexts).toEqual([context,added]);expect(board.nodes.find(n=>n.id==='target')!.x).toBe(999);
 await t.mutation(api.boards.deleteNode,{...action,operationId:'redo-1'});
 await expect(t.mutation(api.boards.restoreNode,action)).rejects.toThrow(/no longer/);
 await t.mutation(api.boards.restoreNode,{...action,operationId:'redo-1'});
 expect((await t.query(api.boards.read,auth)).nodes.find(n=>n.id==='target')!.contexts).toEqual([context,added]);
});
it('enforces deletion ownership and current permissions, and leaves deleted destinations alone',async()=>{
 const {t,auth,bob}=await setup();const action={...auth,nodeKey:'source',operationId:'delete-1'};
 await t.mutation(api.boards.deleteNode,action);
 await expect(t.mutation(api.boards.restoreNode,{...action,token:bob.token})).rejects.toThrow(/no longer/);
 await t.mutation(api.boards.deleteNode,{...bob,nodeKey:'target',operationId:'bob-delete'});
 await t.mutation(api.boards.restoreNode,action);
 expect((await t.query(api.boards.read,auth)).nodes.map(n=>n.id)).not.toContain('target');
 await t.run(async ctx=>{const member=await ctx.db.query('boardMembers').withIndex('board_user',q=>q.eq('boardId',auth.boardId)).filter(q=>q.eq(q.field('role'),'editor')).first();await ctx.db.patch(member!._id,{role:'viewer'});});
 await expect(t.mutation(api.boards.restoreNode,{...bob,nodeKey:'target',operationId:'bob-delete'})).rejects.toThrow();
 await expect(t.mutation(api.boards.deleteNode,{...bob,nodeKey:'source',operationId:'bad'})).rejects.toThrow();
});
it('finishes an in-flight response on the tombstone so restoration does not leave a stuck generating state',async()=>{
 vi.useFakeTimers();const {t,auth}=await setup();
 const runId=await t.mutation(api.chat.send,{...auth,nodeKey:'source',requestId:'run',expectedVersion:0});
 const action={...auth,nodeKey:'source',operationId:'delete-stream'};
 await t.mutation(api.boards.deleteNode,action);
 await t.mutation(internal.chat.append,{runId,text:'',done:true,finalText:'Completed while deleted'});
 await t.mutation(api.boards.restoreNode,action);
 const node=(await t.query(api.boards.read,auth)).nodes.find(n=>n.id==='source')!;
 expect(node.messages.at(-1).text).toBe('Completed while deleted');expect(node.activeRun).toBeUndefined();expect(node.activity).toBeUndefined();
});
it('ignores late text and focus on a deleted branch without changing its undo snapshot',async()=>{
 const {t,auth}=await setup();
 const before=(await t.query(api.boards.read,auth)).nodes.find(n=>n.id==='source')!;
 const action={...auth,nodeKey:'source',operationId:'late-edit'};
 await t.mutation(api.boards.deleteNode,action);
 expect(await t.mutation(api.collaboration.updateText,{...auth,nodeKey:'source',tabId:'late-tab',epoch:0,update:before.sharedTextState})).toEqual({deleted:true,version:before.sharedVersion});
 expect(await t.mutation(api.collaboration.focus,{...auth,nodeKey:'source',tabId:'late-tab',field:'draft'})).toMatchObject({deleted:true,expiresAt:0});
 expect(await t.query(api.collaboration.editors,auth)).toHaveLength(0);
 await t.mutation(api.boards.restoreNode,action);
 const restored=(await t.query(api.boards.read,auth)).nodes.find(n=>n.id==='source')!;
 expect(restored.sharedTextState).toEqual(before.sharedTextState);
 expect(restored.sharedVersion).toBe(before.sharedVersion);
 await expect(t.mutation(api.collaboration.updateText,{...auth,nodeKey:'missing',tabId:'late-tab',epoch:0,update:before.sharedTextState})).rejects.toThrow('Node not found');
});
it('deletes a running agent, stops late research writes, and restores it ready for another goal',async()=>{
 vi.useFakeTimers();const {t,auth}=await setup();
 await t.mutation(api.boards.patchNodes,{...auth,changes:[{id:'source',patch:{agent:true,agentName:'Milo'}}]});
 const runId=await t.mutation(api.chat.send,{...auth,nodeKey:'source',requestId:'agent-run',expectedVersion:0});
 const action={...auth,nodeKey:'source',operationId:'agent-delete'};
 await t.mutation(api.boards.deleteNode,action);
 expect((await t.query(api.boards.read,auth)).nodes.some(n=>n.id==='source')).toBe(false);
 expect((await t.run(ctx=>ctx.db.get(runId)))!.status).toBe('cancelled');
 await t.mutation(internal.chat.append,{runId,text:'Late result',done:true,finalText:'Late result'});
 await t.mutation(api.boards.restoreNode,action);
 const node=(await t.query(api.boards.read,auth)).nodes.find(n=>n.id==='source')!;
 expect(node.agent).toBe(true);expect(node.activeRun).toBeUndefined();expect(node.activity).toBeUndefined();expect(node.agentStage).toBe('Stopped');
 expect(node.messages.at(-1).text).not.toBe('Late result');
});
