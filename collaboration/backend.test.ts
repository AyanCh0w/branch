import { convexTest } from 'convex-test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
import { loadDocument } from '../convex/documents';

const modules = import.meta.glob('../convex/**/*.ts');
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
async function setup() {
  vi.stubEnv('DEV_BRIDGE_SECRET','test-server-secret');vi.stubEnv('ENABLE_DEVELOPMENT_BRIDGE','true');
  const t=convexTest(schema,modules);
  const a=await t.mutation(api.boards.developmentSession,{secret:'test-server-secret',identityKey:'alice',token:'alice-token'});
  const b=await t.mutation(api.boards.developmentSession,{secret:'test-server-secret',identityKey:'bob',token:'bob-token',boardId:a.boardId});
  const auth={token:'alice-token',boardId:a.boardId};
  await t.mutation(api.boards.initialize,{...auth,title:'Test board',nodes:[{id:'chat',type:'thread',title:'Chat',draft:'Start here',messages:[],contexts:[],x:0,y:0},{id:'note',type:'plan',title:'Note',body:'Shared',x:10,y:10}]});
  return {t,a,b,auth,bob:{token:'bob-token',boardId:a.boardId}};
}
describe('shared board boundaries',()=>{
  it('requires an authenticated development session and board membership',async()=>{
    const {t,auth}=await setup();
    await expect(t.query(api.boards.read,{...auth,token:'wrong'})).rejects.toThrow();
    await expect(t.mutation(api.boards.developmentSession,{secret:'wrong',identityKey:'intruder',token:'bad'})).rejects.toThrow();
    const board=await t.query(api.boards.read,auth);expect(board.nodes).toHaveLength(2);
  });
  it('merges simultaneous character edits instead of overwriting either writer',async()=>{
    const {t,auth,bob}=await setup();const board=await t.query(api.boards.read,auth);const state=board.nodes.find(n=>n.id==='note')!.sharedTextState;
    const d1=loadDocument(state),d2=loadDocument(state);const vector=Y.encodeStateVector(d1);
    d1.getText('body').insert(0,'Alice ');d2.getText('body').insert(6,' Bob');
    await Promise.all([[d1,auth,'a'],[d2,bob,'b']].map(([doc,who,tab]:any)=>t.mutation(api.collaboration.updateText,{...who,nodeKey:'note',update:Uint8Array.from(Y.encodeStateAsUpdate(doc,vector)).buffer,tabId:tab,epoch:0})));
    const result=await t.query(api.boards.read,auth);expect(result.nodes.find(n=>n.id==='note')!.body).toBe('Alice Shared Bob');
  });
  it('blocks send while another person edits the node, then creates only one run',async()=>{
    vi.useFakeTimers();const {t,auth,bob,a}=await setup();
    for(const [who,tabId]of [[auth,'a'],[bob,'b']] as const)await t.mutation(api.collaboration.focus,{...who,nodeKey:'chat',field:'draft',tabId});
    const request={...auth,nodeKey:'chat',requestId:'send-once',expectedVersion:0};
    await expect(t.mutation(api.chat.send,request)).rejects.toThrow(/Someone else/);
    await t.mutation(api.collaboration.release,{...auth,tabId:'a'});
    await expect(t.mutation(api.chat.send,request)).rejects.toThrow(/Someone else/);
    await t.mutation(api.collaboration.release,{...bob,tabId:'b'});
    const runId=await t.mutation(api.chat.send,request);
    expect(await t.mutation(api.chat.send,request)).toBe(runId);
    const run=await t.run(ctx=>ctx.db.get(runId));expect(run!.billedUserId).toBe(a.userId);expect(run!.model).toBe('gpt-5.4-mini');
    const board=await t.query(api.boards.read,auth);const chat=board.nodes.find(n=>n.id==='chat')!;expect(chat.draft).toBe('');expect(chat.messages).toHaveLength(2);
    await expect(t.mutation(api.chat.send,{...request,requestId:'second'})).rejects.toThrow(/already generating/);
  });
  it('lets a sole editor send while focused and freezes their acknowledged text',async()=>{
    vi.useFakeTimers();const {t,auth}=await setup();
    await t.mutation(api.collaboration.focus,{...auth,nodeKey:'chat',field:'draft',tabId:'a'});
    const before=await t.query(api.boards.read,auth),chat=before.nodes.find(n=>n.id==='chat')!;
    const doc=loadDocument(chat.sharedTextState),vector=Y.encodeStateVector(doc);
    doc.getText('draft').insert(doc.getText('draft').length,' with my latest edit');
    const result=await t.mutation(api.collaboration.updateText,{...auth,nodeKey:'chat',tabId:'a',epoch:0,update:Uint8Array.from(Y.encodeStateAsUpdate(doc,vector)).buffer});
    const request={...auth,nodeKey:'chat',requestId:'focused-send',expectedVersion:result.version};
    const runId=await t.mutation(api.chat.send,request),run=await t.run(ctx=>ctx.db.get(runId));
    expect(run!.input.messages.at(-1).content).toBe('Start here with my latest edit');
    expect((await t.query(api.collaboration.editors,auth))).toHaveLength(1);
    expect((await t.query(api.boards.read,auth)).nodes.find(n=>n.id==='chat')!.draft).toBe('');
  });
  it('counts people rather than tabs and blocks another person editing the title',async()=>{
    vi.useFakeTimers();const {t,auth,bob}=await setup();
    for(const tabId of ['a','a-other-tab'])await t.mutation(api.collaboration.focus,{...auth,nodeKey:'chat',field:'draft',tabId});
    await t.mutation(api.collaboration.focus,{...bob,nodeKey:'chat',field:'title',tabId:'b'});
    const request={...auth,nodeKey:'chat',requestId:'same-person-tabs',expectedVersion:0};
    await expect(t.mutation(api.chat.send,request)).rejects.toThrow(/Someone else/);
    await t.mutation(api.collaboration.release,{...bob,tabId:'b'});
    expect(await t.mutation(api.chat.send,request)).toBeTruthy();
  });
  it('expired sessions do not block Send and stale draft edits are rejected',async()=>{
    vi.useFakeTimers();const {t,auth,bob}=await setup();const before=await t.query(api.boards.read,auth);const chat=before.nodes.find(n=>n.id==='chat')!;
    await t.mutation(api.collaboration.focus,{...auth,nodeKey:'chat',field:'draft',tabId:'a'});
    await t.mutation(api.collaboration.focus,{...bob,nodeKey:'chat',field:'draft',tabId:'b'});
    vi.setSystemTime(Date.now()+16000);
    await t.mutation(api.chat.send,{...auth,nodeKey:'chat',requestId:'expired-send',expectedVersion:0});
    await t.mutation(api.collaboration.focus,{...auth,nodeKey:'chat',field:'draft',tabId:'a'});
    const doc=loadDocument(chat.sharedTextState),vector=Y.encodeStateVector(doc);doc.getText('draft').insert(0,'Late edit ');
    await expect(t.mutation(api.collaboration.updateText,{...auth,nodeKey:'chat',tabId:'a',epoch:0,update:Uint8Array.from(Y.encodeStateAsUpdate(doc,vector)).buffer})).rejects.toThrow(/already sent/);
  });
  it('separate card patches preserve another collaborator’s changes',async()=>{
    const {t,auth,bob}=await setup();
    await Promise.all([t.mutation(api.boards.patchNodes,{...auth,changes:[{id:'note',patch:{x:100}}]}),t.mutation(api.boards.patchNodes,{...bob,changes:[{id:'note',patch:{width:500}}]})]);
    const board=await t.query(api.boards.read,auth),note=board.nodes.find(n=>n.id==='note')!;expect(note.x).toBe(100);expect(note.width).toBe(500);
  });
});
