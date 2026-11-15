// Ported from backend/tests/agent-context.test.ts: ChatGPT reply sync into
// agent context, desktop pairing, and coding-agent handoffs over /branch/coding.
import {convexTest} from 'convex-test';
import {it,expect,vi,afterEach} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {registerCore,sessionIdentity} from '@convex-dev/auth/test';
import {registerPassword} from '@convex-dev/auth/components/password/test';
import {registerUsername} from '@convex-dev/auth/components/username/test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.ts');
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');

async function setup(){
 vi.stubEnv('CONVEX_CLOUD_URL','https://test.convex.cloud');
 vi.stubEnv('BRANCH_PROXY_SECRET','proxy-secret');
 const t=convexTest(schema,modules);registerCore(t);registerPassword(t);registerUsername(t);
 const account=async(username:string)=>{const r=await t.mutation(api.auth.signUpWithUsernamePassword,{username,password:'unique-agent-context-test-password-5521'});if(r.status!=='complete')throw Error();const client=t.withIdentity(sessionIdentity(r.tokens));const me=await client.query(api.accounts.me,{});return {client,id:me!.id};};
 const owner=await account('context-owner'),viewer=await account('context-viewer');
 const boardId=await owner.client.mutation(api.library.create,{title:'Agent context'});
 await owner.client.mutation(api.sharing.addMember,{boardId,username:'context-viewer',role:'viewer'});
 return {t,owner,viewer,boardId,scope:{boardId,token:''}};
}

it('stores replies per conversation, rejects unapproved writes, and limits reads to board members',async()=>{
 const {t,owner,viewer,boardId,scope}=await setup();
 const conversationId=hash('chrome:chat-1');
 await expect(viewer.client.mutation(api.chatgptBrowser.connect,{boardId,conversationId})).rejects.toThrow('Board access denied');
 const {key}=await owner.client.mutation(api.chatgptBrowser.connect,{boardId,conversationId});
 const update={key,updateId:randomUUID(),title:'Research',result:'First answer'};
 const save=(args:any)=>t.mutation(internal.chatgptBrowser.save,args);
 const [first,retry]=await Promise.all([save(update),save(update)]);
 expect(retry).toEqual(first);
 await save({...update,updateId:randomUUID(),result:'Second answer'});
 const other=await owner.client.mutation(api.chatgptBrowser.connect,{boardId,conversationId:hash('chrome:chat-2')});
 const secondChat=await save({...update,key:other.key});
 expect(secondChat.cardId).not.toBe(first.cardId);
 const board=await viewer.client.query(api.boards.read,scope);
 expect(board.nodes.filter((node:any)=>node.chatgptSynced)).toHaveLength(2);
 expect(JSON.stringify(board)).not.toContain('First answer');
 const read={...scope,nodeKey:first.cardId,limit:10};
 await expect(t.query(api.agentContext.read,read)).rejects.toThrow('Sign in');
 expect((await viewer.client.query(api.agentContext.read,read)).items.map((item:any)=>item.result)).toEqual(['Second answer','First answer']);
 await owner.client.mutation(api.chatgptBrowser.disconnectBoard,{boardId});
 await expect(save({...update,updateId:randomUUID()})).rejects.toThrow('chrome_sync_disconnected');
 expect((await viewer.client.query(api.agentContext.read,read)).items).toHaveLength(2);
});

it('binds desktop approvals to a board, separates browser keys and revokes desktop writes',async()=>{
 const {t,owner,viewer,boardId,scope}=await setup();
 const conversationId=hash('same underlying ChatGPT chat');
 const key=`branch_desktop_${Date.now()+60_000}_${'3'.repeat(64)}`;
 const connect={boardId,conversationId,keyHash:hash(key)};
 const update={key,updateId:randomUUID(),title:'Desktop chat',result:'A completed desktop reply'};
 const save=(args:any)=>t.mutation(internal.chatgptBrowser.save,args);
 const desktopSave=(args:any)=>save({...args,source:'desktop'});
 await expect(desktopSave(update)).rejects.toThrow('chrome_sync_disconnected');
 await expect(viewer.client.mutation(api.chatgptBrowser.connectDesktop,connect)).rejects.toThrow('Board access denied');
 const browser=await owner.client.mutation(api.chatgptBrowser.connect,{boardId,conversationId});
 await owner.client.mutation(api.chatgptBrowser.connectDesktop,connect);
 await expect(desktopSave({...update,key:browser.key})).rejects.toThrow('chrome_sync_disconnected');
 await expect(save(update)).rejects.toThrow('chrome_sync_disconnected');

 const first=await desktopSave(update);
 expect(await desktopSave(update)).toEqual(first);
 expect(await desktopSave({...update,updateId:randomUUID(),result:'The next reply'})).toEqual(first);
 const chrome=await save({...update,key:browser.key});
 expect(chrome.cardId).not.toBe(first.cardId);
 const otherBoard=await owner.client.mutation(api.library.create,{title:'Other desktop board'});
 await expect(owner.client.mutation(api.chatgptBrowser.connectDesktop,{...connect,boardId:otherBoard})).rejects.toThrow('This pairing was already used');
 expect(await t.mutation(internal.chatgptBrowser.stop,{key,source:'desktop'})).toEqual({});
 await expect(desktopSave({...update,updateId:randomUUID()})).rejects.toThrow('chrome_sync_disconnected');
 const saved=await owner.client.query(api.agentContext.read,{...scope,nodeKey:first.cardId,limit:10});
 expect(saved.items.map((item:any)=>item.result)).toEqual(['The next reply',update.result]);

 const expired=`branch_desktop_${Date.now()-1000}_${'4'.repeat(64)}`;
 await owner.client.mutation(api.chatgptBrowser.connectDesktop,{...connect,keyHash:hash(expired)});
 await expect(desktopSave({...update,key:expired})).rejects.toThrow('chrome_sync_disconnected');
});

it('delivers only approved coding handoffs, keeps drafts private, and publishes a result note',async()=>{
 const {t,owner,viewer,scope}=await setup();
 const nodeKey='coding-source';
 const args={...scope,nodeKey};
 await owner.client.mutation(api.boards.patchNodes,{...scope,changes:[{
  id:nodeKey,create:{type:'plan',title:'Shared brief',body:'Keep the board context scoped.',x:32,y:32,width:380},
 }]});
 const {fingerprint}=await owner.client.query(api.coding.preview,args);
 const handoff=await owner.client.mutation(api.coding.create,{...args,fingerprint,sources:[],oneTime:true});
 const code='branch_handoff_'+'7'.repeat(64);
 const call=(name:string,values:object={})=>t.fetch('/branch/coding',{
  method:'POST',
  headers:{'x-branch-proxy':'proxy-secret',authorization:'Bearer '+code,'content-type':'application/json',accept:'application/json, text/event-stream'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{handoffId:handoff.id,...values}}}),
 });
 expect((await call('read_card_handoff')).status).toBe(401);
 await owner.client.mutation(api.coding.approve,{...args,handoffId:handoff.id,approvalHash:hash(code)});
 const read=await (await call('read_card_handoff')).json();
 expect(JSON.parse(read.result.content[0].text).text).toContain('Keep the board context scoped.');
 const returned=await (await call('return_card_draft',{text:'# Implementation\n\nVerified in tests.'})).json();
 expect(returned.result.content[0].text).toContain('Draft saved.');
 const afterReturn=await (await call('read_card_handoff')).json();
 expect(afterReturn.result.isError).toBe(true);
 await expect(viewer.client.query(api.coding.draft,args)).rejects.toThrow('Board access denied');
 const privateBoard=await viewer.client.query(api.boards.read,scope);
 expect(JSON.stringify(privateBoard)).not.toContain('Verified in tests.');
 const noteKey=await owner.client.mutation(api.coding.resolve,{...args,handoffId:handoff.id,publish:true});
 const shared=await viewer.client.query(api.boards.read,scope);
 expect(shared.nodes.find((node:any)=>node.id===noteKey)).toMatchObject({
  title:'Implementation',body:'# Implementation\n\nVerified in tests.',
  codingNote:{sourceKey:nodeKey,handoffId:handoff.id},
 });
 expect((await call('read_card_handoff')).status).toBe(401);
 // Requests that did not come through the app server are refused before any credential check.
 const direct=await t.fetch('/branch/coding',{method:'POST',headers:{authorization:'Bearer '+code,'content-type':'application/json'},body:'{}'});
 expect(direct.status).toBe(403);
});
