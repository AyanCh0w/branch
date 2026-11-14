const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const note=(id,x,y,width=300)=>({id,type:'plan',title:id,titleEdited:true,body:'A plain note',x,y,width,revision:1});
function boot(nodes=[]){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://127.0.0.1:4387/app',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.matchMedia=()=>({matches:true,addEventListener(){}});w.ResizeObserver=class{observe(){}disconnect(){}};w.HTMLCanvasElement.prototype.getContext=()=>null;
 w.HTMLElement.prototype.getAnimations=()=>[];w.HTMLElement.prototype.setPointerCapture=function(){};w.HTMLElement.prototype.releasePointerCapture=function(){};
 w.requestAnimationFrame=()=>1;w.document.fonts={ready:Promise.resolve()};
 w.localStorage.setItem('branch-workspace-v2',JSON.stringify({title:'Test',events:[],nodes}));
 for(const script of ['icons.js','media.js','context.js','reactive-grid.js','markdown.bundle.js','app.js','whiteboard.js'])vm.runInContext(fs.readFileSync(path.join(root,script),'utf8'),dom.getInternalVMContext());
 w.document.body.classList.remove('account-mode');
 return dom;
}
function pointer(w,target,type,x,y,extra={}){const e=new w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y,...extra});Object.defineProperty(e,'pointerId',{value:1});target.dispatchEvent(e);return e;}
function key(w,key,extra={},target=w.document.body){const e=new w.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra});target.dispatchEvent(e);return e;}
function selectAll(w){key(w,'a',{ctrlKey:true});}
function geometry(w){for(const n of w.BranchHost.getState().nodes){const el=w.document.querySelector(`[data-node="${n.id}"]`);Object.defineProperties(el,{offsetWidth:{configurable:true,get:()=>n.width||300},offsetHeight:{configurable:true,get:()=>100}});el.getBoundingClientRect=()=>({left:n.x,top:n.y,right:n.x+(n.width||300),bottom:n.y+100,width:n.width||300,height:100});}}

test('notes are the default creation action and use a single plaintext editor without chat or note chrome',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  assert.equal(d.querySelector('[data-create]').dataset.create,'plan');assert.equal(d.querySelector('[data-dock]').dataset.dock,'plan');
  assert.equal(d.querySelector('#empty-note').hidden,false);d.querySelector('#empty-note').click();
  const n=w.BranchHost.getState().nodes[0];assert.equal(n.type,'plan');assert.equal(n.body,'');assert.equal(d.activeElement.getAttribute('aria-label'),'Note text');
  assert.equal(d.querySelector('.plan-body').getAttribute('contenteditable'),'plaintext-only');
  assert.equal(d.querySelector('.plain-note .composer,.plain-note .card-footer,.plain-note .node-controls,.plain-note .note-preview-toggle'),null);
  assert.equal(d.querySelector('#empty-note').hidden,true);
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});
test('marquee selects intersecting cards, shift adds, and cancellation restores the previous selection',()=>{
 const dom=boot([note('a',100,100),note('b',500,100),note('c',900,100)]),w=dom.window,d=w.document,b=d.querySelector('#board');
 try{
  geometry(w);pointer(w,b,'pointerdown',70,60);pointer(w,b,'pointermove',810,220);pointer(w,b,'pointerup',810,220);
  assert.equal(d.querySelectorAll('.board-selected').length,2);assert.equal(d.querySelector('#selection-marquee').hidden,true);
  pointer(w,b,'pointerdown',850,60,{shiftKey:true});pointer(w,b,'pointermove',1220,220);key(w,'Escape');
  assert.equal(d.querySelectorAll('.board-selected').length,2);
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});
test('shift clicking grips toggles cards and dragging a selected grip moves the whole selection; Escape rolls back',()=>{
 const dom=boot([note('a',100,100),note('b',500,200)]),w=dom.window,d=w.document;
 try{
  const grip=id=>d.querySelector(`[data-node="${id}"] .title-grip`);
  pointer(w,grip('a'),'pointerdown',100,80,{shiftKey:true});pointer(w,grip('b'),'pointerdown',500,180,{shiftKey:true});
  assert.equal(d.querySelectorAll('.board-selected').length,2);
  pointer(w,grip('a'),'pointerdown',100,80);pointer(w,d.body,'pointermove',140,110);
  assert.deepEqual(Array.from(w.BranchHost.getState().nodes,n=>[n.x,n.y]),[[140,130],[540,230]]);
  key(w,'Escape');assert.deepEqual(Array.from(w.BranchHost.getState().nodes,n=>[n.x,n.y]),[[100,100],[500,200]]);
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});
test('group movement patches current nodes and shared subscription updates retain remote text during a drag',()=>{
 const dom=boot([note('a',100,100),note('b',500,200)]),w=dom.window,d=w.document,moves=[];
 try{
  w.BoardShared={enabled:true,writable:true,saveState(){},refreshLocks(){},moveNodes:n=>moves.push(n.map(x=>({id:x.id,x:x.x,y:x.y})))};
  selectAll(w);const grip=d.querySelector('[data-node="a"] .title-grip');pointer(w,grip,'pointerdown',100,80);pointer(w,d.body,'pointermove',140,110);
  const remote=JSON.parse(JSON.stringify(w.BranchHost.getState()));remote.nodes[0].x=100;remote.nodes[0].body='Remote collaborator edit';w.BranchHost.receive(remote);
  pointer(w,d.body,'pointerup',140,110);assert.equal(w.BranchHost.getState().nodes[0].body,'Remote collaborator edit');assert.equal(moves[0][0].x,140);assert.equal(moves[0].length,2);
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});
test('arrangement uses actual sizes and keeps endpoints fixed while distributing equal gaps',()=>{
 const dom=boot([note('a',100,100,200),note('b',500,300,300),note('c',1100,500,100)]),w=dom.window,d=w.document;
 try{
  geometry(w);selectAll(w);d.querySelector('[data-selection-action="top"]').click();assert.deepEqual(Array.from(w.BranchHost.getState().nodes,n=>n.y),[100,100,100]);
  d.querySelector('[data-selection-action="spaceX"]').click();assert.deepEqual(Array.from(w.BranchHost.getState().nodes,n=>n.x),[100,550,1100]);
  key(w,'z',{ctrlKey:true});assert.deepEqual(Array.from(w.BranchHost.getState().nodes,n=>n.x),[100,500,1100]);
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});
test('tidy separates overlapping cards into rows with room for their different sizes',()=>{
 const dom=boot([note('a',100,100,200),note('b',100,100,300),note('c',100,100,100)]),w=dom.window,d=w.document;
 try{
  geometry(w);selectAll(w);d.querySelector('[data-selection-action="tidy"]').click();
  assert.deepEqual(Array.from(w.BranchHost.getState().nodes,n=>[n.x,n.y]),[[100,100],[364,100],[100,280]]);
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});
test('plain note editing never schedules automatic AI titles and does not add AI expansion controls',async()=>{
 const n=note('a',100,100);delete n.titleEdited;
 const dom=boot([n]),w=dom.window,d=w.document,requests=[];
 try{
  w.fetch=async url=>{requests.push(url);return {ok:false};};
  const node=w.BranchHost.getState().nodes[0];delete node.titleEdited;
  const editor=d.querySelector('.plan-body');editor.focus();editor.innerText='A new idea';editor.dispatchEvent(new w.Event('input',{bubbles:true}));editor.blur();
  await new Promise(resolve=>setTimeout(resolve,700));
  assert.equal(requests.some(url=>String(url).includes('/api/title')),false);assert.equal(d.querySelector('.plain-note [data-expand-idea]'),null);
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});
test('duplicate remaps copied sources while keeping frozen snapshots and strips active runs',()=>{
 const a=note('a',100,100),chat={id:'chat',type:'thread',title:'Chat',x:500,y:100,activeRun:'run',sharedVersion:9,activity:'writing',messages:[{id:'m',role:'assistant',text:'Answer'}],contexts:[{id:'ctx',source:'a',title:'Old note',body:'Frozen text',revision:1,enabled:true}],draft:'Next prompt'};
 const dom=boot([a,chat]),w=dom.window;
 try{
  selectAll(w);key(w,'d',{ctrlKey:true});const nodes=w.BranchHost.getState().nodes;assert.equal(nodes.length,4);
  const copied=nodes[3];assert.equal(copied.contexts[0].source,nodes[2].id);assert.equal(copied.contexts[0].body,'Frozen text');assert.notEqual(copied.contexts[0].id,'ctx');
  assert.equal(copied.activeRun,undefined);assert.equal(copied.sharedVersion,undefined);assert.equal(copied.draft,'Next prompt');assert.equal(copied.messages[0].text,'Answer');
  assert.equal(nodes[1].contexts[0].source,'a');
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});
test('keyboard nudges respect editing and viewer mode; Shift moves ten pixels',()=>{
 const dom=boot([note('a',100,100)]),w=dom.window,d=w.document;
 try{
  selectAll(w);key(w,'ArrowRight');key(w,'ArrowDown',{shiftKey:true});let n=w.BranchHost.getState().nodes[0];assert.equal(n.x,101);assert.equal(n.y,110);
  key(w,'ArrowRight',{},d.querySelector('.plan-body'));assert.equal(n.x,101);
  w.BoardShared={enabled:true,writable:false};key(w,'ArrowRight');key(w,'d',{ctrlKey:true});assert.equal(n.x,101);assert.equal(w.BranchHost.getState().nodes.length,1);
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});
test('Space drag pans and ordinary trackpad scroll still pans without moving cards',()=>{
 const dom=boot([note('a',100,100)]),w=dom.window,d=w.document,b=d.querySelector('#board');
 try{
  const before=d.querySelector('#world').style.transform;key(w,' ',{code:'Space'});pointer(w,b,'pointerdown',20,20);pointer(w,d.body,'pointermove',70,70);pointer(w,d.body,'pointerup',70,70);
  assert.notEqual(d.querySelector('#world').style.transform,before);assert.equal(w.BranchHost.getState().nodes[0].x,100);
  d.dispatchEvent(new w.KeyboardEvent('keyup',{code:'Space',bubbles:true}));assert.equal(d.body.classList.contains('canvas-hand'),false);
  const after=d.querySelector('#world').style.transform;b.dispatchEvent(new w.WheelEvent('wheel',{deltaY:30,bubbles:true,cancelable:true}));assert.notEqual(d.querySelector('#world').style.transform,after);
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});
test('remote deletion prunes local selection and never resurrects a removed node',()=>{
 const dom=boot([note('a',100,100),note('b',500,200)]),w=dom.window,d=w.document;
 try{selectAll(w);w.BranchHost.receive({title:'Test',nodes:[note('b',500,200)]});assert.equal(d.querySelectorAll('.board-selected').length,1);key(w,'d',{ctrlKey:true});assert.equal(w.BranchHost.getState().nodes.length,2);assert.equal(w.BranchHost.getState().nodes.some(n=>n.id==='a'),false);}finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});
