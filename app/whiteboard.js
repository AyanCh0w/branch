'use strict';
// Local selection is a view preference. Content and geometry use the existing
// node/Yjs paths; selection never serializes or replaces a shared board.
(() => {
 const selected = new Set();
 let tool = 'select', space = false, marquee = null;
 const board = $('#board');
 const editable = target => !!target.closest('input,textarea,[contenteditable],select,dialog');
 const writable = () => !window.BoardShared?.enabled || window.BoardShared.writable;
 const active = () => !document.body.classList.contains('account-mode');
 const visibleNodes = () => state.nodes.filter(n => n.id !== panelNodeId && !collapsedAgentSource(n));
 const selectedNodes = () => visibleNodes().filter(n => selected.has(n.id));
 const glyph = name => icon(name) || `<img src="icons/${name}.svg" alt="" aria-hidden="true">`;

 const toolsBar = document.createElement('div');
 toolsBar.className = 'whiteboard-tools'; toolsBar.setAttribute('role', 'group'); toolsBar.setAttribute('aria-label', 'Canvas tools');
 toolsBar.innerHTML = `<button type="button" data-canvas-tool="select" aria-label="Select · V" data-tooltip="Select · V" aria-pressed="true">${glyph('cursor-pointer')}</button><button type="button" data-canvas-tool="hand" aria-label="Hand · H or hold Space" data-tooltip="Hand · H or hold Space" aria-pressed="false">${glyph('drag-hand-gesture')}</button><span class="dock-divider" aria-hidden="true"></span>`;
 creationDock.prepend(toolsBar);
 toolsBar.addEventListener('click', e => { const value = e.target.closest('[data-canvas-tool]')?.dataset.canvasTool; if(value) setTool(value); });

 const rectangle = document.createElement('div');
 rectangle.id = 'selection-marquee'; rectangle.hidden = true; rectangle.setAttribute('aria-hidden', 'true'); document.body.append(rectangle);

 const empty = document.createElement('button');
 empty.id = 'empty-note'; empty.type = 'button';
 empty.innerHTML = glyph('page') + '<span>Start with a note</span><kbd>N</kbd>';
 empty.addEventListener('pointerdown', e => e.stopPropagation());
 empty.onclick = () => { if(!writable()) return; const n = newCard('plan', boardInsertPoint()); cardEl(n.id)?.querySelector('.plan-body')?.focus({preventScroll:true}); };
 document.body.append(empty);

 function setTool(value) {
  tool = value; document.body.classList.toggle('canvas-hand', tool === 'hand' || space);
  for(const b of toolsBar.querySelectorAll('[data-canvas-tool]')) b.setAttribute('aria-pressed', String(b.dataset.canvasTool === tool));
 }
 function sync() {
  const visible = new Set(visibleNodes().map(n => n.id));
  for(const key of selected) if(!visible.has(key)) selected.delete(key);
  for(const el of $$('#cards .card')) el.classList.toggle('board-selected', selected.has(el.dataset.node));
  empty.hidden = !!state.nodes.length || !writable();
 }
 function select(keys) { selected.clear(); for(const key of keys) selected.add(key); sync(); }
 function moveMembers() {
  const nodes = selectedNodes(), agents = new Set(nodes.filter(n => n.agent).map(n => n.id));
  return state.nodes.filter(n => selected.has(n.id) || agents.has(n.autoGroup));
 }
 function bounds(n) {
  const el = cardEl(n.id);
  return { x:n.x, y:n.y, w:el?.offsetWidth || n.width || (n.type === 'thread' ? 520 : 380), h:el?.offsetHeight || n.minHeight || 160 };
 }
 function persistMovement(nodes, label) {
  for(const n of nodes) positionCard(n);
  window.BoardShared?.moveNodes?.(nodes); record(label); requestDraw(); sync();
 }
 function duplicate() {
  if(!writable() || !selected.size) return;
  document.activeElement?.blur(); commitEdit();
  const originals = moveMembers(); if(!originals.length) return;
  // Retain immutable context snapshots, but map their source IDs when the source
  // is also duplicated. Run IDs, leases and generated layouts are never copied.
  const ids = new Map(originals.map(n => [n.id,id()]));
  const remap = context => ({ ...context, id:id(), source:ids.get(context.source)||context.source,
   ...(context.inherited ? {inherited:context.inherited.map(remap)} : {}) });
  remember();
  const copies = originals.map(original => {
   const n = clone(original); n.id = ids.get(original.id); n.x += 40; n.y += 40;
   for(const key of ['activeRun','activity','agentStage','sharedVersion','sharedTextState','draftEpoch','authorProfile','previewOrigin','layoutHeight']) delete n[key];
   if(n.autoGroup) { if(ids.has(n.autoGroup)) n.autoGroup = ids.get(n.autoGroup); else {delete n.autoGroup; delete n.researchSource;} }
   if(n.contextFor) { if(ids.has(n.contextFor)) n.contextFor = ids.get(n.contextFor); else delete n.contextFor; }
   if(n.contexts) n.contexts = n.contexts.map(remap);
   n.titleEdited = true; return n;
  });
  state.nodes.push(...copies); for(const n of copies) refreshCard(n);
  select(copies.filter(n => !collapsedAgentSource(n)).map(n => n.id)); record('Duplicated cards');
  notify(`Duplicated ${copies.length} card${copies.length === 1 ? '' : 's'}`);
 }
 function fitSelection() {
  const boxes = selectedNodes().map(bounds); if(!boxes.length) return;
  const left = Math.min(...boxes.map(b=>b.x)), top = Math.min(...boxes.map(b=>b.y))-48;
  const right = Math.max(...boxes.map(b=>b.x+b.w)), bottom = Math.max(...boxes.map(b=>b.y+b.h));
  camera.z = Math.max(.1,Math.min(1.5,(innerWidth-120)/(right-left),(innerHeight-260)/(bottom-top)));
  camera.x = (innerWidth-(right-left)*camera.z)/2-left*camera.z;
  camera.y = (innerHeight-220-(bottom-top)*camera.z)/2-top*camera.z;
  applyCamera();
 }
 function stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }
 function cancelMarquee(restore=true) {
  if(!marquee) return;
  const old = marquee; marquee = null; rectangle.hidden = true;
  if(board.hasPointerCapture?.(old.pointer)) board.releasePointerCapture(old.pointer);
  if(restore) select(old.before);
 }
 document.addEventListener('pointerdown', e => {
  if(!active() || gesture || marquee || e.isPrimary === false || e.button !== 0 || !e.target.closest('#board')) return;
  if(e.target.closest('[data-agent-stack],branch-pdf')) return;
  if(space || tool === 'hand') {
   if(editable(e.target)) return;
   stop(e); startGesture(e,{kind:'pan',ox:camera.x,oy:camera.y}); return;
  }
  if(!writable()) return;
  const card = e.target.closest('.card');
  if(card) {
   const key = card.dataset.node;
   const handle = e.target.closest('.title-grip,.drag-strip') || e.target === card;
   if(e.shiftKey && handle) { stop(e); selected.has(key) ? selected.delete(key) : selected.add(key); sync(); return; }
   if(!selected.has(key)) select([key]);
   return;
  }
  stop(e); document.activeElement?.blur(); commitEdit(); hideSelection(); closeCreateMenu();
  const before = [...selected]; if(!e.shiftKey) select([]);
  marquee = {pointer:e.pointerId,x:e.clientX,y:e.clientY,before,base:e.shiftKey?before:[]};
  board.setPointerCapture?.(e.pointerId);
 },true);
 document.addEventListener('pointermove', e => {
  if(!marquee || e.pointerId !== marquee.pointer) return;
  stop(e);
  const left=Math.min(marquee.x,e.clientX),top=Math.min(marquee.y,e.clientY),right=Math.max(marquee.x,e.clientX),bottom=Math.max(marquee.y,e.clientY);
  if(Math.hypot(right-left,bottom-top)<4) return;
  rectangle.hidden=false; Object.assign(rectangle.style,{left:left+'px',top:top+'px',width:right-left+'px',height:bottom-top+'px'});
  const hits=visibleNodes().filter(n=>{const r=cardEl(n.id)?.getBoundingClientRect();return r?.width && r.height && r.right>=left && r.left<=right && r.bottom>=top && r.top-42*camera.z<=bottom;});
  select([...marquee.base,...hits.map(n=>n.id)]);
 },true);
 document.addEventListener('pointerup', e => {if(marquee && e.pointerId===marquee.pointer){stop(e);cancelMarquee(false);}},true);
 document.addEventListener('pointercancel', () => cancelMarquee(),true);
 board.addEventListener('lostpointercapture', () => cancelMarquee());
 board.addEventListener('wheel', e => {if(marquee)stop(e);},{capture:true,passive:false});
 window.addEventListener('blur', () => {space=false;setTool(tool);cancelMarquee();});

 document.addEventListener('keydown', e => {
  if(!active() || editable(e.target) || $('#help-dialog').open || e.target.closest('#create-menu,#context-menu')) return;
  if(e.key==='Escape') { if(marquee){stop(e);cancelMarquee();return;} select([]); return; }
  if(e.code==='Space' && !e.target.closest('button,a,[role=button]')) { e.preventDefault(); space=true;setTool(tool);return; }
  if(gesture || marquee) return;
  const modifier=e.metaKey||e.ctrlKey, key=e.key.toLowerCase();
  if(modifier && key==='a') {stop(e);select(visibleNodes().map(n=>n.id));return;}
  if(modifier && key==='d' && selected.size && writable()) {stop(e);if(!e.repeat)duplicate();return;}
  if(e.shiftKey && key==='f') {stop(e);fitSelection();return;}
  if(modifier||e.altKey)return;
  if(key==='v'||key==='h') {stop(e);setTool(key==='v'?'select':'hand');return;}
  if(!writable()) return;
  if(selected.size && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key) && !e.target.closest('#creation-dock,.resize-handle')) {
   stop(e);remember(); const step=e.shiftKey?10:1, dx=({ArrowLeft:-step,ArrowRight:step}[e.key]||0),dy=({ArrowUp:-step,ArrowDown:step}[e.key]||0);
   const nodes=moveMembers(); for(const n of nodes){n.x+=dx;n.y+=dy;} persistMovement(nodes,'Nudged cards');
  }
 },true);
 document.addEventListener('keyup', e => {if(e.code==='Space'){space=false;setTool(tool);}},true);
 document.addEventListener('focusin', e => {if(e.target.closest('.card') && !selected.has(e.target.closest('.card').dataset.node))select([e.target.closest('.card').dataset.node]);});
 document.addEventListener('branch-camera', () => {if(marquee)cancelMarquee();});
 window.BranchWhiteboard = {sync,has:key=>selected.has(key),moveMembers};
 const observer=new MutationObserver(sync);observer.observe(document.body,{attributes:true,attributeFilter:['class']});
 window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
 sync(); setTool('select');
})();
