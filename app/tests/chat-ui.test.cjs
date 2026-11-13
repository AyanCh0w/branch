const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
function boot(reduce=true){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://127.0.0.1:4387/app',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 w.matchMedia=()=>({matches:reduce,addEventListener(){}});w.ResizeObserver=class{constructor(cb){w.resizeCards=cb;}observe(){}disconnect(){}};w.HTMLCanvasElement.prototype.getContext=()=>null;w.HTMLElement.prototype.getAnimations=()=>[];w.requestAnimationFrame=callback=>{w.paintFrame=callback;return 1;};w.document.fonts={ready:Promise.resolve()};
 w.localStorage.setItem('branch-workspace-v2',JSON.stringify({title:'Test',events:[],nodes:[{id:'chat',type:'thread',title:'Test chat',x:100,y:100,messages:[{id:'reply',role:'assistant',text:'# Recommendation\n\n| Choice | Example |\n| --- | --- |\n| MVP | One workflow |'}],contexts:[],draft:'A shared draft'}]}));
 for(const script of ['icons.js','media.js','context.js','reactive-grid.js','markdown.bundle.js','app.js'])w.eval(fs.readFileSync(path.join(root,script),'utf8'));
 return dom;
}
test('workspace boots with Markdown, compact previews and dock; panel keeps a single live shared composer',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  assert.ok(d.querySelector('#creation-dock'));assert.ok(d.querySelector('.compact-chat'));assert.ok(d.querySelector('.markdown-table table'));assert.equal(d.querySelectorAll('h1').length,1);
  d.querySelector('.open-chat-panel').click();assert.ok(d.querySelector('#chat-panel .card'));assert.equal(d.querySelectorAll('[data-node="chat"]').length,1);assert.ok(d.querySelector('[data-panel-placeholder="chat"]'));assert.equal(d.querySelector('#chat-panel .compact-chat'),null);
  const edits=[];w.BoardShared={enabled:true,writable:true,edit:(n,field,value)=>edits.push({id:n.id,field,value}),saveState(){},refreshLocks(){}};
  const prompt=d.querySelector('#chat-panel [data-prompt]');prompt.value='Edited in panel';prompt.dispatchEvent(new w.Event('input',{bubbles:true}));assert.deepEqual(edits,[{id:'chat',field:'draft',value:'Edited in panel'}]);
  const remote=JSON.parse(JSON.stringify(w.BranchHost.getState()));remote.nodes[0].messages.push({id:'remote-reply',role:'assistant',text:'## Collaborator reply'});w.BranchHost.receive(remote);assert.equal(d.querySelector('#chat-panel h2').textContent,'Test chat');assert.ok(d.querySelector('#chat-panel [data-message="remote-reply"] h2'));assert.equal(d.querySelectorAll('[data-node="chat"]').length,1);
  d.querySelector('[data-close-chat-panel]').click();assert.equal(d.querySelector('#chat-panel'),null);assert.equal(d.querySelector('#cards [data-prompt]').value,'Edited in panel');assert.ok(d.querySelector('.compact-chat'));
  d.querySelector('.chat-preview-toggle').click();assert.equal(d.querySelector('.compact-chat'),null);
 }finally{dom.window.close();}
});
test('Markdown supports GFM structures and removes executable or unsafe content',()=>{
 const dom=boot(),w=dom.window;
 try{
  const out=w.document.createElement('div');out.innerHTML=w.BranchMarkdown('## Heading\n\n- Parent\n  - Child\n\n> Quote\n\n```js\nconst x = "<script>";\n```\n\n- [x] Done\n\n~~Old~~\n\n[bad](javascript:alert(1))\n\n<img src=x onerror=alert(1)><script>alert(1)</script>');
  for(const selector of ['h2','ul ul','blockquote','pre code','del','.markdown-task'])assert.ok(out.querySelector(selector),selector);
  assert.equal(out.querySelector('script,img,[onerror],a[href^="javascript:"]'),null);assert.match(out.querySelector('code').textContent,/<script>/);
  out.innerHTML=w.BranchMarkdown('| Name | Value |\n| --- | ---: |\n| **Example** | `42` |');assert.equal(out.querySelectorAll('th').length,2);assert.equal(out.querySelectorAll('td').length,2);
 }finally{dom.window.close();}
});
test('trackpad gestures pan consistently across expanded conversations and the canvas',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  d.querySelector('.chat-preview-toggle').click();
  const transcript=d.querySelector('.chat-surface'),board=d.querySelector('#board'),world=d.querySelector('#world');
  // Even stale overflow measurements must not give the transcript wheel ownership.
  Object.defineProperties(transcript,{scrollHeight:{value:1200},clientHeight:{value:480}});
  const wheel=(target,options)=>{const event=new w.WheelEvent('wheel',{bubbles:true,cancelable:true,...options});target.dispatchEvent(event);assert.equal(event.defaultPrevented,true);return world.style.transform;};
  const before=world.style.transform;
  const vertical=wheel(transcript,{deltaY:90});assert.notEqual(vertical,before);
  const diagonal=wheel(transcript,{deltaX:25,deltaY:60});assert.notEqual(diagonal,vertical);
  const background=wheel(board,{deltaY:90});assert.notEqual(background,diagonal);
  const zoom=w.document.querySelector('#zoom').textContent;
  wheel(transcript,{deltaY:-20,ctrlKey:true,clientX:300,clientY:250});
  assert.notEqual(d.querySelector('#zoom').textContent,zoom);
 }finally{dom.window.close();}
});
test('scrollable composer retains text scrolling while pinch still zooms the board',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  const prompt=d.querySelector('[data-prompt]'),world=d.querySelector('#world');
  Object.defineProperties(prompt,{scrollHeight:{value:400},clientHeight:{value:100}});prompt.scrollTop=50;
  const before=world.style.transform,event=new w.WheelEvent('wheel',{deltaY:30,bubbles:true,cancelable:true});prompt.dispatchEvent(event);
  assert.equal(event.defaultPrevented,false);assert.equal(world.style.transform,before);
  const pinch=new w.WheelEvent('wheel',{deltaY:-20,ctrlKey:true,clientX:300,clientY:250,bubbles:true,cancelable:true});prompt.dispatchEvent(pinch);
  assert.equal(pinch.defaultPrevented,true);assert.notEqual(world.style.transform,before);
 }finally{dom.window.close();}
});
test('ordinary message links open interactive page nodes; modified clicks and browser fallback remain links',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  const state=JSON.parse(JSON.stringify(w.BranchHost.getState()));
  state.nodes[0].messages[0].text='Read [Example](https://example.com/docs).';w.BranchHost.receive(state);
  const link=d.querySelector('[data-message-text] a');
  const modified=new w.MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true});link.dispatchEvent(modified);
  assert.equal(modified.defaultPrevented,false);assert.equal(w.BranchHost.getState().nodes.length,1);
  const click=new w.MouseEvent('click',{bubbles:true,cancelable:true});link.dispatchEvent(click);
  assert.equal(click.defaultPrevented,true);
  const page=w.BranchHost.getState().nodes.find(n=>n.type==='web');assert.equal(page.url,'https://example.com/docs');assert.ok(page.x>state.nodes[0].x);
  const frame=d.querySelector('.website-viewport iframe');assert.equal(frame.src,page.url);assert.equal(frame.getAttribute('tabindex'),null);assert.equal(d.querySelector('.website-open'),null);
  assert.match(frame.getAttribute('sandbox'),/allow-forms/);assert.match(frame.getAttribute('sandbox'),/allow-same-origin/);
  const fallback=d.querySelector('[data-open-browser]'),external=new w.MouseEvent('click',{bubbles:true,cancelable:true});fallback.dispatchEvent(external);
  assert.equal(external.defaultPrevented,false);assert.equal(w.BranchHost.getState().nodes.length,2);
 }finally{dom.window.close();}
});
test('research source links open page nodes without rewriting provenance and viewers do not create nodes',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  const state=JSON.parse(JSON.stringify(w.BranchHost.getState()));
  state.nodes.push({id:'source',type:'web',title:'Research source',url:'http://127.0.0.1:4387/example',researchSource:true,x:700,y:0});w.BranchHost.receive(state);
  const link=d.querySelector('.research-source-body a');
  w.BoardShared={enabled:true,writable:false};const viewer=new w.MouseEvent('click',{bubbles:true,cancelable:true});link.dispatchEvent(viewer);
  assert.equal(viewer.defaultPrevented,false);assert.equal(w.BranchHost.getState().nodes.length,2);
  w.BoardShared=null;link.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));
  assert.equal(w.BranchHost.getState().nodes.length,3);assert.equal(w.BranchHost.getState().nodes.find(n=>n.id==='source').researchSource,true);
  assert.doesNotMatch(d.querySelector('.website-viewport iframe').getAttribute('sandbox'),/allow-same-origin/);
 }finally{dom.window.close();}
});
test('delete then Ctrl/Command+Z restores the local card and all context attachments; Shift redoes it',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  d.body.classList.remove('account-mode');
  const state=JSON.parse(JSON.stringify(w.BranchHost.getState()));
  state.nodes.push({id:'note',type:'plan',title:'Source note',body:'Keep me',x:20,y:30});
  state.nodes[0].contexts=[{id:'connection',source:'note',title:'Source note',body:'Frozen note',quote:'Keep',enabled:true}];
  w.BranchHost.receive(JSON.parse(JSON.stringify(state)));
  const before=JSON.stringify(w.BranchHost.getState().nodes);
  d.querySelector('[data-node="chat"] .delete-card').click();
  assert.equal(w.BranchHost.getState().nodes.length,1);
  d.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));
  assert.equal(JSON.stringify(w.BranchHost.getState().nodes),before);
  d.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Z',metaKey:true,shiftKey:true,bubbles:true}));
  assert.equal(w.BranchHost.getState().nodes.length,1);
  d.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'z',metaKey:true,bubbles:true}));
  assert.equal(JSON.stringify(w.BranchHost.getState().nodes),before);
 }finally{dom.window.close();}
});

test('dock agents have an identity and goal composer without item-level launch buttons',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  w.eval(fs.readFileSync(path.join(root,'auto-layout.js'),'utf8'));
  d.body.classList.remove('account-mode');
  assert.equal(d.querySelector('[data-create-agent]'),null);d.querySelector('[data-dock="agent"]').click();
  const agent=w.BranchHost.getState().nodes.find(n=>n.agent);
  assert.ok(agent.agentName);assert.equal(agent.autoGroup,agent.id);assert.equal(agent.contexts.length,0);
  const el=d.querySelector(`[data-node="${agent.id}"]`);
  assert.ok(el.classList.contains('agent-card'));assert.equal(el.classList.contains('compact-chat'),false);
  assert.equal(el.querySelector('[data-prompt]').placeholder,'Give your agent a goal…');
  assert.match(el.querySelector('.agent-heading').textContent,new RegExp(agent.agentName));
  assert.equal(el.querySelector('.composer .mode-chip').textContent.trim(),'Agent');assert.equal(el.querySelector('[data-agent-mode]'),null);
  const updated=JSON.parse(JSON.stringify(w.BranchHost.getState()));const running=updated.nodes.find(n=>n.id===agent.id);running.activeRun='test-run';running.agentStage='Verifying findings';running.activity='searching';w.BranchHost.receive(updated);
  assert.ok(d.querySelector(`[data-node="${agent.id}"] [data-stop-agent]`));
  assert.match(d.querySelector(`[data-node="${agent.id}"] [data-agent-status]`).textContent,/Verifying findings · Searching/);
  const completed=JSON.parse(JSON.stringify(w.BranchHost.getState()));const done=completed.nodes.find(n=>n.id===agent.id);delete done.activeRun;delete done.activity;done.agentStage='Complete';w.BranchHost.receive(completed);
  assert.equal(d.querySelector(`[data-node="${agent.id}"] [data-stop-agent]`),null);
  assert.equal(d.querySelector(`[data-node="${agent.id}"] .agent-identity`).dataset.running,'false');
 }finally{dom.window.close();}
});

test('agent sources fold locally, expand with keyboard and the entire group follows drag and cancellation',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  w.eval(fs.readFileSync(path.join(root,'auto-layout.js'),'utf8'));w.HTMLElement.prototype.setPointerCapture=()=>{};
  const snapshot={title:'Stack test',nodes:[
   {id:'agent',type:'thread',agent:true,agentName:'Atlas',autoGroup:'agent',title:'Agent',x:600,y:300,messages:[],contexts:[],draft:''},
   {id:'s1',type:'web',researchSource:true,autoGroup:'agent',title:'Team',url:'https://example.com/team',x:0,y:100},
   {id:'s2',type:'web',researchSource:true,autoGroup:'agent',title:'Judges',url:'https://example.com/judges',x:0,y:500},
   {id:'result',type:'plan',autoGroup:'agent',title:'Results',body:'Verified people',x:1200,y:300},
   {id:'other',type:'plan',title:'Other work',body:'Keep',x:1800,y:500}
  ]};
  w.BranchHost.receive(JSON.parse(JSON.stringify(snapshot)));
  const stack=d.querySelector('[data-agent-stack="agent"] button');assert.ok(stack);assert.equal(stack.getAttribute('aria-expanded'),'false');
  assert.ok(d.querySelector('[data-node="s1"]').hidden);assert.ok(d.querySelector('[data-node="s2"]').hidden);
  assert.equal(w.BranchHost.getState().nodes.find(n=>n.id==='s1').x,0);
  stack.click();assert.equal(stack.getAttribute('aria-expanded'),'true');assert.equal(d.querySelector('[data-node="s1"]').hidden,false);
  stack.click();assert.equal(d.querySelector('[data-node="s1"]').hidden,true);assert.equal(d.activeElement,stack);
  const grip=d.querySelector('[data-node="agent"] .title-grip');grip.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  let nodes=w.BranchHost.getState().nodes;for(const old of snapshot.nodes)assert.equal(nodes.find(n=>n.id===old.id).x,old.x+(old.id==='other'?0:20));
  const before=JSON.parse(JSON.stringify(nodes));
  grip.dispatchEvent(new w.MouseEvent('pointerdown',{button:0,clientX:700,clientY:300,bubbles:true}));
  d.body.dispatchEvent(new w.MouseEvent('pointermove',{clientX:760,clientY:340,bubbles:true}));
  nodes=w.BranchHost.getState().nodes;for(const old of before){const current=nodes.find(n=>n.id===old.id);assert.equal(current.x,old.x+(old.id==='other'?0:60));assert.equal(current.y,old.y+(old.id==='other'?0:40));}
  // A collaborator's streamed update must not snap any member back mid-drag.
  const remote=JSON.parse(JSON.stringify({title:'Stack test',nodes:before}));remote.nodes[0].activity='searching';w.BranchHost.receive(remote);
  assert.equal(w.BranchHost.getState().nodes.find(n=>n.id==='s1').x,80);
  d.body.dispatchEvent(new w.MouseEvent('pointercancel',{bubbles:true}));
  for(const old of before){const current=w.BranchHost.getState().nodes.find(n=>n.id===old.id);assert.equal(current.x,old.x);assert.equal(current.y,old.y);}
  // A successful release explicitly persists every group member, even after receive.
  const moves=[];w.BoardShared={enabled:true,writable:true,edit(){},saveState(){},refreshLocks(){},moveNodes(ns){moves.push(ns.map(n=>({id:n.id,x:n.x,y:n.y})));}};
  const nextGrip=d.querySelector('[data-node="agent"] .title-grip');nextGrip.dispatchEvent(new w.MouseEvent('pointerdown',{button:0,clientX:700,clientY:300,bubbles:true}));d.body.dispatchEvent(new w.MouseEvent('pointermove',{clientX:730,clientY:320,bubbles:true}));d.body.dispatchEvent(new w.MouseEvent('pointerup',{clientX:730,clientY:320,bubbles:true}));
  assert.equal(moves.length,1);assert.deepEqual(Array.from(moves[0],n=>n.id).sort(),['agent','result','s1','s2']);
 }finally{dom.window.close();}
});

test('agent list keeps live pipes, folds to the agent, and clears collisions as one workspace',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  w.eval(fs.readFileSync(path.join(root,'auto-layout.js'),'utf8'));
  w.BranchHost.receive({title:'Research',nodes:[{id:'a',type:'thread',agent:true,agentName:'Atlas',autoGroup:'a',x:400,y:200,title:'Agent',messages:[],contexts:[{id:'ctx',source:'s',enabled:true}],activeRun:'run'},{id:'s',type:'web',researchSource:true,autoGroup:'a',x:0,y:200,title:'Source',url:'https://example.com'},{id:'out',type:'plan',autoGroup:'a',x:1000,y:200,title:'Result',body:'Result'},{id:'obstacle',type:'plan',x:400,y:200,title:'Other',body:'Stay here'}]});
  assert.equal(d.querySelectorAll('.agent-source-row').length,1);
  const port=d.querySelector('.source-row-port');port.getBoundingClientRect=()=>({left:100,top:150,width:6,height:12});
  w.paintFrame(16);assert.ok(d.querySelector('#permanent-wires .wire-flow'));
  const before=w.BranchHost.getState().nodes.map(n=>({...n}));w.resizeCards();
  const after=w.BranchHost.getState().nodes,delta=after.find(n=>n.id==='a').y-before[0].y;assert.ok(delta>0);
  for(const key of ['s','out'])assert.equal(after.find(n=>n.id===key).y-before.find(n=>n.id===key).y,delta);
  assert.equal(after.find(n=>n.id==='obstacle').y,200);
  d.querySelector('[data-workspace-toggle]').click();assert.ok(d.querySelector('[data-node="a"]').classList.contains('workspace-folded'));assert.ok(d.querySelector('[data-node="out"]').hidden);assert.equal(d.querySelector('[data-agent-stack]'),null);
  d.querySelector('[data-workspace-toggle]').click();assert.equal(d.querySelector('[data-node="out"]').hidden,false);assert.ok(d.querySelector('.agent-source-row'));
 }finally{dom.window.close();}
});
test('board menu creates at the click, navigates with keys and dismisses without leaking shortcuts',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  const board=d.querySelector('#board'),menu=d.querySelector('#create-menu');
  const open=()=>board.dispatchEvent(new w.MouseEvent('contextmenu',{clientX:420,clientY:300,bubbles:true,cancelable:true}));
  open();assert.equal(menu.hidden,false);assert.equal(menu.querySelector('button span').textContent,'New node');
  assert.equal(d.activeElement,menu.querySelector('button'));
  d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  assert.equal(d.activeElement.dataset.create,'plan');
  const count=w.BranchHost.getState().nodes.length;
  d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'n',bubbles:true}));
  assert.equal(w.BranchHost.getState().nodes.length,count);
  menu.querySelector('button').click();
  const node=w.BranchHost.getState().nodes.at(-1);assert.equal(node.type,'thread');assert.equal(node.x,420);assert.equal(node.y,235);assert.equal(menu.hidden,true);
  open();d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(menu.hidden,true);
  open();board.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(menu.hidden,true);
  w.BoardShared={enabled:true,writable:false};open();assert.equal(menu.hidden,true);
 }finally{dom.window.close();}
});
test('preview provenance survives rerender and wires follow the exact repeated link',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  const state=JSON.parse(JSON.stringify(w.BranchHost.getState()));
  state.nodes[0].messages[0].text='[First](https://example.com) and [Second](https://example.com)';w.BranchHost.receive(state);
  d.querySelectorAll('[data-message-text] a')[1].click();
  const page=w.BranchHost.getState().nodes.find(n=>n.type==='web');
  assert.deepEqual(JSON.parse(JSON.stringify(page.previewOrigin)),{source:'chat',message:'reply',url:'https://example.com/',occurrence:1});
  assert.equal(page.contexts,undefined,'visual pipes must not add model context');
  w.BranchHost.receive(JSON.parse(JSON.stringify(w.BranchHost.getState())));
  const links=d.querySelectorAll('[data-message-text] a'),port=d.querySelector('.preview-input');
  let x=400;links[1].getClientRects=()=>[{left:x,top:200,right:x+70,width:70,height:20}];
  port.getBoundingClientRect=()=>({left:700,top:250,width:10,height:23});
  w.paintFrame(16);
  const wire=d.querySelector('.preview-wire');assert.ok(wire);const before=wire.getAttribute('d');
  assert.equal(links[0].classList.contains('preview-link-connected'),false);assert.ok(links[1].classList.contains('preview-link-connected'));
  x=450;d.dispatchEvent(new w.Event('scroll'));w.paintFrame(32);assert.notEqual(wire.getAttribute('d'),before);
  links[1].getClientRects=()=>[];d.dispatchEvent(new w.Event('scroll'));w.paintFrame(48);assert.equal(d.querySelector('.preview-wire'),null);
 }finally{dom.window.close();}
});
test('pointer opens expand from link bounds; keyboard and reduced motion skip expansion',()=>{
 for(const [reduce,detail,expected]of [[false,1,1],[true,1,0],[false,0,0]]){
  const dom=boot(reduce),w=dom.window,d=w.document;let animations=0;
  try{
   const state=JSON.parse(JSON.stringify(w.BranchHost.getState()));state.nodes[0].messages[0].text='[Example](https://example.com)';w.BranchHost.receive(state);
   const link=d.querySelector('[data-message-text] a');link.getClientRects=()=>[{left:300,top:200,right:380,width:80,height:20}];
   w.HTMLElement.prototype.getBoundingClientRect=()=>({left:700,top:150,right:1240,bottom:619,width:540,height:469});
   w.HTMLElement.prototype.animate=function(frames,options){animations++;assert.match(frames[0].transform,/scale\(/);assert.equal(options.duration,280);return{cancel(){this.oncancel?.();}};};
   link.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true,detail}));assert.equal(animations,expected);
  }finally{dom.window.close();}
 }
});
test('dragging a link places one connected preview at the ghost position and Escape cancels',()=>{
 const dom=boot(false),w=dom.window,d=w.document;
 try{
  d.body.classList.remove('account-mode');w.HTMLElement.prototype.setPointerCapture=()=>{};
  d.elementFromPoint=()=>d.querySelector('#board');
  const state=JSON.parse(JSON.stringify(w.BranchHost.getState()));state.nodes[0].messages[0].text='[Example](https://example.com)';w.BranchHost.receive(state);
  const link=d.querySelector('[data-message-text] a');
  link.getBoundingClientRect=()=>({left:200,top:200,right:280,width:80,height:20});link.getClientRects=()=>[link.getBoundingClientRect()];
  const pointer=(target,type,x,y)=>target.dispatchEvent(new w.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true,cancelable:true}));
  pointer(link,'pointerdown',210,210);pointer(d.body,'pointermove',600,350);
  const ghost=d.querySelector('#link-ghost');assert.ok(ghost);const placement=ghost.style.transform;
  assert.equal(ghost.textContent,'Example');assert.equal(ghost.style.width,'80px');assert.equal(ghost.querySelector('iframe'),null);
  ghost.getBoundingClientRect=()=>({left:590,top:340,width:80,height:22});
  w.HTMLElement.prototype.getBoundingClientRect=()=>({left:590,top:340,width:540,height:469});
  let entrance;
  w.HTMLElement.prototype.animate=function(frames){entrance=frames;return{cancel(){this.oncancel?.();}};};
  pointer(d.body,'pointerup',600,350);assert.equal(d.querySelector('#link-ghost'),null);assert.ok(entrance);assert.match(entrance[0].transform,/scale\(0\.148/);
  const page=w.BranchHost.getState().nodes.find(n=>n.type==='web');assert.ok(page.previewOrigin);assert.equal(d.querySelector(`[data-node="${page.id}"]`).style.transform,placement);
  link.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));assert.equal(w.BranchHost.getState().nodes.length,2,'release click must not create a duplicate');
  pointer(link,'pointerdown',210,210);pointer(d.body,'pointermove',650,350);assert.ok(d.querySelector('#link-ghost'));
  d.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.querySelector('#link-ghost'),null);
  pointer(d.body,'pointerup',650,350);assert.equal(w.BranchHost.getState().nodes.length,2);
 }finally{dom.window.close();}
});

test('unavailable embeds have a local browser fallback and retry without changing source data',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  const state=JSON.parse(JSON.stringify(w.BranchHost.getState()));state.nodes[0].messages[0].text='[Example](https://example.com)';w.BranchHost.receive(state);
  d.querySelector('[data-node-link]').click();const before=JSON.stringify(w.BranchHost.getState().nodes);
  d.querySelector('[data-embed-help]').click();assert.equal(d.querySelector('.website-viewport iframe'),null);
  assert.equal(d.querySelector('.website-fallback [data-open-browser]').href,'https://example.com/');
  assert.equal(JSON.stringify(w.BranchHost.getState().nodes),before);
  d.querySelector('[data-retry-embed]').click();assert.ok(d.querySelector('.website-viewport iframe'));assert.equal(d.querySelector('.website-fallback'),null);
 }finally{dom.window.close();}
});
test('creation shortcuts use the pointer at any pan/zoom without scrolling, and animate with reduced-motion support',()=>{
 for(const reduce of [false,true]){
  const dom=boot(reduce),w=dom.window,d=w.document;
  try{
   d.body.classList.remove('account-mode');
   const animations=[],focuses=[];
   w.HTMLElement.prototype.animate=function(frames,options){const entry={frames,options,cancelled:false};animations.push(entry);return {cancel(){entry.cancelled=true;}};};
   const focus=w.HTMLElement.prototype.focus;
   w.HTMLElement.prototype.focus=function(options){focuses.push(options);return focus.call(this,options);};
   const board=d.querySelector('#board'),world=d.querySelector('#world');
   board.dispatchEvent(new w.WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:370,deltaY:240}));
   board.dispatchEvent(new w.WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:150,clientX:400,clientY:300}));
   const before=world.style.transform;
   const [,cx,cy,z]=before.match(/translate3d\(([-\d.]+)px,\s*([-\d.]+)px,0\) scale\(([-\d.]+)\)/)||[];
   assert.ok(z,before);
   for(const key of ['c','n','s']){
    board.dispatchEvent(new w.MouseEvent('pointermove',{bubbles:true,clientX:320,clientY:270}));
    d.body.dispatchEvent(new w.KeyboardEvent('keydown',{key,bubbles:true}));
    const node=w.BranchHost.getState().nodes.at(-1);
    assert.ok(Math.abs(node.x-(320-Number(cx))/Number(z))<.01);
    assert.ok(Math.abs(node.y-(270-65-Number(cy))/Number(z))<.01);
    assert.equal(world.style.transform,before);
    assert.equal(focuses.at(-1).preventScroll,true);
   }
   assert.equal(animations.length,reduce?0:3);
   if(!reduce){assert.equal(animations[0].options.duration,180);d.querySelector('.card:last-child').dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true,button:2}));assert.equal(animations.at(-1).cancelled,true);}
  }finally{dom.window.close();}
 }
});
test('agent trash control routes through shared deletion',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  assert.equal(d.querySelector('[data-create-agent]'),null);d.querySelector('[data-dock="agent"]').click();
  const agent=w.BranchHost.getState().nodes.find(n=>n.agent),deleted=[];
  w.BoardShared={enabled:true,writable:true,saveState(){},deleteNode:key=>deleted.push(key)};
  d.querySelector(`[data-node="${agent.id}"] .delete-card`).click();
  assert.deepEqual(deleted,[agent.id]);
 }finally{dom.window.close();}
});

test('selected text drags like a link into an editable note with the same grab offset',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  d.body.classList.remove('account-mode');w.HTMLElement.prototype.setPointerCapture=()=>{};
  d.elementFromPoint=()=>d.querySelector('#board');
  const state=JSON.parse(JSON.stringify(w.BranchHost.getState()));state.nodes[0].messages[0].text='Before [selected words](https://example.com) after';w.BranchHost.receive(state);
  const link=d.querySelector('[data-message-text] a'),range=d.createRange();range.selectNodeContents(link);
  const rect={left:200,top:200,right:300,bottom:220,width:100,height:20};
  w.Range.prototype.getClientRects=()=>[rect];w.Range.prototype.getBoundingClientRect=()=>rect;
  w.getSelection().addRange(range);d.dispatchEvent(new w.Event('selectionchange'));
  const pointer=(target,type,x,y)=>target.dispatchEvent(new w.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true,cancelable:true}));
  pointer(link,'pointerdown',210,210);pointer(d.body,'pointermove',213,210);
  assert.equal(d.querySelector('#link-ghost'),null,'same seven-pixel threshold as links');
  pointer(d.body,'pointermove',600,350);
  const ghost=d.querySelector('#link-ghost');assert.equal(ghost.textContent,'selected words');assert.ok(ghost.classList.contains('excerpt-ghost'));const placement=ghost.style.transform;
  pointer(d.body,'pointerup',600,350);
  const branch=w.BranchHost.getState().nodes.find(n=>n.id!=='chat');assert.equal(branch.type,'plan');assert.equal(branch.body,'selected words');assert.ok(d.querySelector(`[data-node="${branch.id}"] .plan-body[contenteditable]`));assert.ok(d.querySelector(`[data-node="${branch.id}"] .nib`));assert.equal(d.querySelector(`[data-node="${branch.id}"]`).style.transform,placement);assert.equal(d.querySelector('#link-ghost'),null);
  // A cancelled second drag must leave both cards intact.
  w.getSelection().addRange(range);d.dispatchEvent(new w.Event('selectionchange'));
  pointer(link,'pointerdown',210,210);pointer(d.body,'pointermove',650,350);
  d.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));pointer(d.body,'pointerup',650,350);
  assert.equal(w.BranchHost.getState().nodes.length,2);assert.equal(d.querySelector('#link-ghost'),null);
 }finally{dom.window.close();}
});

test('Agent dock control creates a ready agent without starting a run and blocks viewers',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  const button=d.querySelector('[data-dock="agent"]');assert.equal(button.getAttribute('aria-label'),'Agent');
  button.click();const agent=w.BranchHost.getState().nodes.find(n=>n.agent);
  assert.ok(agent);assert.equal(agent.type,'thread');assert.equal(agent.contexts.length,0);assert.equal(agent.messages.length,0);assert.ok(agent.agentName);assert.equal(agent.activeRun,undefined);
  assert.equal(d.activeElement,d.querySelector(`[data-node="${agent.id}"] [data-prompt]`));
  w.BoardShared={enabled:true,writable:false};button.click();assert.equal(w.BranchHost.getState().nodes.filter(n=>n.agent).length,1);
 }finally{dom.window.close();}
});

test('agent dock drags the full node, preserves identity and placement, restocks and cancels cleanly',()=>{
 const dom=boot(false),w=dom.window,d=w.document;
 try{
  d.body.classList.remove('account-mode');w.HTMLElement.prototype.setPointerCapture=()=>{};d.elementFromPoint=()=>d.querySelector('#board');
  let restocks=0;w.HTMLElement.prototype.animate=function(){if(this.classList.contains('dock-agent-avatar'))restocks++;return{cancel(){}};};
  const button=d.querySelector('[data-dock="agent"]'),pointer=(target,type,x,y)=>target.dispatchEvent(new w.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true,cancelable:true}));
  pointer(button,'pointerdown',500,700);pointer(d.body,'pointermove',600,350);
  const preview=d.querySelector('#agent-drag-preview .agent-card'),agentId=preview.dataset.node,placement=preview.style.transform;
  assert.ok(preview.querySelector('[data-prompt]'));assert.ok(preview.querySelector('.agent-identity'));assert.equal(w.BranchHost.getState().nodes.length,1);assert.ok(d.querySelector('#creation-dock').classList.contains('agent-in-hand'));
  pointer(d.body,'pointerup',600,350);
  assert.equal(d.querySelector('#agent-drag-preview'),null);assert.equal(d.querySelector(`[data-node="${agentId}"]`).style.transform,placement);assert.ok(w.BranchHost.getState().nodes.find(n=>n.id===agentId)?.agent);assert.equal(restocks,1);
  button.click();assert.equal(w.BranchHost.getState().nodes.length,2,'release click does not duplicate agent');
  pointer(button,'pointerdown',500,700);pointer(d.body,'pointermove',700,350);assert.notEqual(d.querySelector('#agent-drag-preview .card').dataset.node,agentId);
  d.body.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));pointer(d.body,'pointerup',700,350);
  assert.equal(d.querySelector('#agent-drag-preview'),null);assert.equal(w.BranchHost.getState().nodes.length,2);assert.equal(restocks,1);assert.ok(!d.querySelector('#creation-dock').classList.contains('agent-in-hand'));
 }finally{dom.window.close();}
});

for(const reduce of [false,true])test(`agent cursors reflect real arrivals without replay or state delays (reduced motion: ${reduce})`,()=>{
 const dom=boot(reduce),w=dom.window,d=w.document;
 try{
  d.body.classList.remove('account-mode');
  w.HTMLElement.prototype.getBoundingClientRect=function(){const row=this.matches('[data-source-row]');return {left:row?100:450,top:200,right:row?340:970,bottom:240,width:row?240:520,height:40};};
  const animations=[];w.HTMLElement.prototype.animate=function(frames,options){const animation={cancelled:false,cancel(){this.cancelled=true;}};if(this.classList.contains('agent-cursor'))animations.push({frames,options,animation});return animation;};
  const agent={id:'researcher',type:'thread',agent:true,agentName:'Atlas',activeRun:'run1',activity:'searching',x:450,y:100,title:'Research',messages:[],contexts:[]};
  const source=i=>({id:'source'+i,type:'web',title:'Source '+i,url:'https://example.com/'+i,researchSource:true,autoGroup:agent.id,x:100,y:100});
  const receive=nodes=>w.BranchHost.receive(JSON.parse(JSON.stringify({title:'Research',nodes})));
  receive([agent,source(0)]);
  assert.match(d.querySelector('.agent-cursor-label').textContent,/Atlas · Agent · Searching/);assert.equal(animations.length,0,'existing sources must not replay on opening a board');
  receive([agent,source(0),source(1),source(2)]);
  assert.equal(w.BranchHost.getState().nodes.length,4,'nodes are immediately available');
  assert.equal(animations.length,reduce?0:1,'batch uses one motion');
  if(!reduce){assert.equal(animations[0].options.duration,280);assert.match(d.querySelector('.agent-cursor-cargo').textContent,/Source 2 \+1/);assert.match(animations[0].frames[1].transform,/120px/,'lands on the real collapsed context row');}
  receive([agent,source(0),source(1),source(2)]);assert.equal(animations.length,reduce?0:1,'stream updates do not replay arrivals');
  receive([agent,source(0),source(1),source(2),source(3)]);
  if(!reduce){assert.equal(animations.length,2);assert.ok(animations[0].animation.cancelled);assert.equal(d.querySelectorAll('.agent-cursor-cargo').length,1);}
  d.body.dispatchEvent(new w.Event('pointerdown',{bubbles:true}));assert.equal(d.querySelector('.agent-cursor-cargo'),null,'user actions interrupt decorative motion');
  receive([{...agent,activeRun:undefined,activity:undefined},source(0)]);assert.equal(d.querySelector('.agent-cursor'),null,'completion/stop removes cursor');
  receive([{...agent,activeRun:'run2'},source(0),source(4)]);assert.equal(animations.length,reduce?0:2,'new runs do not replay old arrivals');
  receive([]);assert.equal(d.querySelector('.agent-cursor'),null,'deletion/navigation cleans up');
 }finally{dom.window.close();}
});

test('playful agent identities keep saturated colors across dock, card and shared reload',()=>{
 const dom=boot(),w=dom.window,d=w.document;
 try{
  const avatars=[];w.BranchAvatar=(name,color)=>{avatars.push({name,color});return 'data:image/svg+xml,';};w.dispatchEvent(new w.Event('load'));
  const dockColor=d.querySelector('[data-dock="agent"]').style.getPropertyValue('--agent-color');
  d.querySelector('[data-dock="agent"]').click();const agent=w.BranchHost.getState().nodes.find(n=>n.agent);
  assert.match(agent.agentName,/^\w+ \w+$/);
  const identity=()=>d.querySelector(`[data-node="${agent.id}"] .agent-identity`);
  assert.equal(identity().style.getPropertyValue('--agent-color'),dockColor);
  assert.ok(avatars.some(a=>a.name.includes(agent.id)&&a.color===dockColor));
  const rgb=dockColor.slice(1).match(/../g).map(v=>parseInt(v,16));assert.ok((Math.max(...rgb)-Math.min(...rgb))/Math.max(...rgb)>.8);
  const snapshot=JSON.parse(JSON.stringify(w.BranchHost.getState()));w.BranchHost.receive(snapshot);
  assert.equal(identity().style.getPropertyValue('--agent-color'),dockColor);assert.equal(w.BranchHost.getState().nodes.find(n=>n.id===agent.id).agentName,agent.agentName);
  w.BranchHost.receive({title:'Colors',nodes:Array.from({length:24},(_,i)=>({...agent,id:'agent-'+i,autoGroup:'agent-'+i}))});
  const colors=[...d.querySelectorAll('.agent-identity')].map(el=>el.style.getPropertyValue('--agent-color'));assert.ok(new Set(colors).size>15);
 }finally{dom.window.close();}
});
