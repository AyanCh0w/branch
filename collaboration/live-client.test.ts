import {it,expect,vi,afterEach} from 'vitest';
import {JSDOM} from 'jsdom';
import * as Y from 'yjs';
let dom:JSDOM;
afterEach(()=>{dom?.window.close();vi.unstubAllGlobals();vi.useRealTimers();vi.resetModules();});
it.each([false,true])('receives live board changes even when URL replacement fails: %s',async(rejectHistory)=>{
 vi.useFakeTimers();
 dom=new JSDOM('<button id="undo"></button><span id="save-state"></span>',{url:'http://localhost/app'});
 const w=dom.window;
 for(const name of ['window','document','location','localStorage','HTMLTextAreaElement','NodeFilter'])vi.stubGlobal(name,name==='window'?w:(w as any)[name]);
 vi.stubGlobal('getSelection',()=>w.getSelection());
 const replace=vi.spyOn(w.history,'replaceState');
 if(rejectHistory)replace.mockImplementation(()=>{throw new TypeError('Can only call History.replaceState on instances of History');});
 const callbacks=new Map<string,(value:any)=>void>();
 const stops=[vi.fn(),vi.fn(),vi.fn()];
 let connection:(value:any)=>void=()=>{};
 const client={query:vi.fn(async()=>({title:'Initial',role:'owner',nodes:[]})),mutation:vi.fn(async()=>{}),connectionState:()=>({isWebSocketConnected:true}),onUpdate:vi.fn((name:string,_args:any,callback:any)=>{callbacks.set(name,callback);return stops[callbacks.size-1];}),subscribeToConnectionState:vi.fn((callback:any)=>{connection=callback;return stops[2];})};
 let state:any={title:'',nodes:[]};
 const notify=vi.fn();
 (w as any).BranchHost={getState:()=>state,receive:(next:any)=>{state=next;},notify};
 await import('./client.js');
 const shared=(w as any).BoardShared;
 await shared.connect({client,boardId:'board',token:'test'});
 expect(shared.enabled).toBe(true);
 expect(w.document.body.classList.contains('shared-starting')).toBe(false);
 expect(callbacks.size).toBe(2);
 expect(replace).toHaveBeenCalledOnce();
 if(!rejectHistory)expect(w.location.search).toBe('?board=board');
 callbacks.get('boards:read')!({title:'Live update',role:'owner',nodes:[]});
 expect(state.title).toBe('Live update');
 connection({isWebSocketConnected:false});
 expect(w.document.getElementById('save-state')!.textContent).toContain('Reconnecting');
 connection({isWebSocketConnected:true});
 expect(w.document.getElementById('save-state')!.textContent).toBe('Shared · saved');
 expect(notify).not.toHaveBeenCalled();
 await shared.disconnect();
 for(const stop of stops)expect(stop).toHaveBeenCalledOnce();
});

it.each([0,1])('renews an expired draft lease without replaying an already sent epoch: %s',async(renewedEpoch)=>{
 vi.useFakeTimers();
 dom=new JSDOM('<span id="save-state"></span><div class="card" data-node="chat"><textarea data-prompt></textarea><button class="send-message"></button></div>',{url:'https://joinbranch.dev/?board=board'});
 const w=dom.window;
 for(const name of ['window','document','location','localStorage','HTMLTextAreaElement','NodeFilter'])vi.stubGlobal(name,name==='window'?w:(w as any)[name]);
 vi.stubGlobal('getSelection',()=>w.getSelection());
 const serverDoc=new Y.Doc();for(const field of ['body','title','draft'])serverDoc.getText(field);
 let state:any={title:'Board',nodes:[]},writes=0;
 const snapshot=()=>({title:'Board',role:'owner',nodes:[{id:'chat',type:'thread',contexts:[],messages:[],sharedVersion:writes,sharedTextState:Array.from(Y.encodeStateAsUpdate(serverDoc)),draftEpoch:0}]});
 let connection:any;
 const client={query:vi.fn(async()=>snapshot()),mutation:vi.fn(async(name:string,args:any)=>{
  if(name==='collaboration:updateText'){
   if(++writes===1)throw Error('Editing session expired. Your draft has been kept locally.');
   Y.applyUpdate(serverDoc,new Uint8Array(args.update));return {version:writes};
  }
  if(name==='collaboration:focus')return {epoch:renewedEpoch,expiresAt:Date.now()+15000};
 }),connectionState:()=>({isWebSocketConnected:true}),onUpdate:()=>()=>{},subscribeToConnectionState:(cb:any)=>{connection=cb;return()=>{};}};
 const notify=vi.fn();
 (w as any).BranchHost={getState:()=>state,receive:(s:any)=>{state=s;},notify,prepareVideoTranscripts:async()=>[],refreshText:()=>{}};
 await import('./client.js');const shared=(w as any).BoardShared;
 await shared.connect({client,boardId:'board',token:'test'});
 state.nodes[0].draft='give ideas';shared.edit(state.nodes[0],'draft','give ideas');
 await shared.send('chat');
 if(renewedEpoch===0){
  expect(serverDoc.getText('draft').toString()).toBe('give ideas');
  expect(writes).toBe(2);
  expect(client.mutation.mock.calls.filter(c=>c[0]==='chat:send')).toHaveLength(1);
  expect((w.document.querySelector('.send-message') as HTMLButtonElement).disabled).toBe(false);
  expect(notify).not.toHaveBeenCalled();
 }else{
  expect(writes).toBe(1);expect(client.mutation.mock.calls.some(c=>c[0]==='chat:send')).toBe(false);
  expect(w.localStorage.getItem('branch-unsynced-board')).toContain('give ideas');
  connection({isWebSocketConnected:false});connection({isWebSocketConnected:true});
  expect(w.document.getElementById('save-state')!.textContent).toContain('Sync paused');
 }
 await shared.disconnect();serverDoc.destroy();
});
