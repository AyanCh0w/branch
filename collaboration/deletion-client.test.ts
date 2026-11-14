import {it,expect,vi,afterEach} from 'vitest';
import {JSDOM} from 'jsdom';
import {initialDocument} from '../convex/documents';
let dom:JSDOM;
afterEach(()=>{dom?.window.close();vi.unstubAllGlobals();vi.useRealTimers();vi.resetModules();});
it('queues immediate undo after deletion, restores through targeted mutations, and routes canvas shortcuts',async()=>{
 vi.useFakeTimers();
 dom=new JSDOM('<button id="undo"></button><span id="save-state"></span>',{url:'http://localhost/app'});
 const w=dom.window;
 for(const name of ['window','document','location','localStorage','HTMLTextAreaElement','NodeFilter'])vi.stubGlobal(name,name==='window'?w:(w as any)[name]);
 vi.stubGlobal('getSelection',()=>w.getSelection());
 const original={id:'note',type:'plan',body:'Saved note',title:'Note',x:10,y:20,sharedTextState:initialDocument({body:'Saved note',title:'Note'})};
 let nodes:any[]=[original],state:any={title:'Board',nodes:[]};
 const client={query:vi.fn(async()=>({title:'Board',role:'owner',nodes:structuredClone(nodes)})),mutation:vi.fn(async(name:string)=>{
  if(name==='boards:deleteNode')nodes=[];
  else if(name==='boards:restoreNode')nodes=[original];
  else if(name!=='collaboration:release')throw Error('Unexpected mutation: '+name);
 }),connectionState:()=>({isWebSocketConnected:true}),onUpdate:()=>()=>{},subscribeToConnectionState:()=>()=>{}};
 (w as any).BranchHost={getState:()=>state,receive:(next:any)=>{state=next;},notify:vi.fn()};
 await import('./client.js');
 const shared=(w as any).BoardShared;
 // Stand in for the canvas shortcut; the client captures only text-editor undo.
 w.document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();shared.undo(e.shiftKey);}});
 await shared.connect({client,boardId:'board',token:'test'});
 const deletion=shared.deleteNode('note');
 const undo=shared.undo();
 await Promise.all([deletion,undo]);
 expect(state.nodes[0].body).toBe('Saved note');
 expect(client.mutation.mock.calls.map(c=>c[0])).toEqual(['boards:deleteNode','boards:restoreNode']);
 w.document.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Z',ctrlKey:true,shiftKey:true,bubbles:true}));
 // Disconnect drains queued history work before changing boards.
 await shared.disconnect();
 expect(nodes).toHaveLength(0);
 expect(client.mutation.mock.calls.map(c=>c[0])).toContain('boards:deleteNode');
});
it.each([false,true])('keeps deletion working after a remote branch deletion (in flight: %s)',async(inFlight)=>{
 vi.useFakeTimers();
 dom=new JSDOM('<button id="undo"></button><span id="save-state"></span>',{url:'http://localhost/app'});
 const w=dom.window;
 for(const name of ['window','document','location','localStorage','HTMLTextAreaElement','NodeFilter'])vi.stubGlobal(name,name==='window'?w:(w as any)[name]);
 vi.stubGlobal('getSelection',()=>w.getSelection());
 const branch={id:'branch',type:'thread',body:'Saved',title:'Branch',sharedTextState:initialDocument({body:'Saved',title:'Branch'})};
 const sibling={id:'sibling',type:'thread',title:'Sibling',sharedTextState:initialDocument({title:'Sibling'})};
 let nodes:any[]=[branch,sibling],state:any={title:'Board',nodes:[]},receive:any,finish:any;
 const snapshot=()=>({title:'Board',role:'owner',nodes:structuredClone(nodes)});
 const client={query:vi.fn(async()=>snapshot()),mutation:vi.fn(async(name:string,args:any)=>{
  if(name==='collaboration:updateText')return new Promise(resolve=>{finish=()=>resolve({deleted:true,version:0});});
  if(name==='boards:deleteNode')nodes=nodes.filter(n=>n.id!==args.nodeKey);
  else if(name==='boards:restoreNode')nodes.push(branch);
  else if(name!=='collaboration:release')throw Error('Unexpected mutation: '+name);
 }),connectionState:()=>({isWebSocketConnected:true}),onUpdate:(name:string,_args:any,cb:any)=>{if(name==='boards:live')receive=cb;return ()=>{};},subscribeToConnectionState:()=>()=>{}};
 (w as any).BranchHost={getState:()=>state,receive:(next:any)=>{state=next;},notify:vi.fn()};
 await import('./client.js');
 const shared=(w as any).BoardShared;
 await shared.connect({client,boardId:'board',token:'test'});
 shared.edit(state.nodes[0],'body','Unacknowledged edit');
 if(inFlight)await vi.advanceTimersByTimeAsync(600);
 nodes=[sibling];
 if(inFlight){finish();await vi.advanceTimersByTimeAsync(0);}else receive(snapshot());
 await shared.deleteNode('sibling');
 expect(nodes).toHaveLength(0);
 expect(w.document.querySelector('#save-state')!.textContent).not.toContain('paused');
 expect(client.mutation.mock.calls.filter(c=>c[0]==='collaboration:updateText')).toHaveLength(inFlight?1:0);
 // A later canonical restoration must not reuse the stale local Yjs document.
 nodes=[branch];receive(snapshot());
 expect(state.nodes[0].body).toBe('Saved');
 expect(w.localStorage.getItem('branch-unsynced-board')).toBeTruthy();
 await shared.disconnect();
});
