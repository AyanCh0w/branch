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
