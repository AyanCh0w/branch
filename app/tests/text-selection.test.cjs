const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
function boot(){
 const dom=new JSDOM('<body><article class="card" data-node="note"><div contenteditable="true"><p>Before <strong>sel</strong>ected words, after.</p><p>Second line here.</p></div></article></body>',{runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document,source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 w.Range.prototype.getClientRects=()=>[{left:100,right:220,top:100,bottom:120,width:120,height:20},{left:40,right:180,top:132,bottom:152,width:140,height:20}];
 w.eval('let gesture=null,selection=null;function updateSelectionHandle(){const s=getSelection();paintRoundedSelection(document.querySelector(".card"),[...s.getRangeAt(0).getClientRects()]);}\n'+source.slice(source.indexOf('function clearRoundedSelection('),source.indexOf('async function fetchVideoTranscript')));
 const p=d.querySelector('p'),tail=p.lastChild,second=d.querySelectorAll('p')[1].firstChild;
 d.caretRangeFromPoint=x=>{const range=d.createRange();const [node,offset]=x<20?[p.firstChild,2]:x<40?[d.querySelector('strong').firstChild,1]:x<80?[tail,8]:[second,8];range.setStart(node,offset);range.collapse(true);return range;};
 const pointer=(type,x)=>p.dispatchEvent(new w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:100}));
 return {dom,w,d,pointer};
}
test('mouse selection snaps both ends across inline formatting and reverses around the anchor',()=>{
 const {dom,w,d,pointer}=boot();try{
  pointer('pointerdown',30);pointer('mousedown',30);pointer('pointermove',60);
  assert.equal(w.getSelection().toString(),'selected words');
  pointer('pointermove',10);assert.equal(w.getSelection().toString(),'Before selected');
  pointer('pointermove',100);assert.equal(w.getSelection().toString(),'selected words, after.Second line');
  pointer('pointerup',100);assert.equal(d.querySelectorAll('#selection-highlight path').length,1);
 }finally{dom.window.close();}
});
test('selection outline joins line gaps with one finite closed contour',()=>{
 const {dom,w}=boot();try{
  const outline=w.eval('selectionOutline(selectionBlobs([{left:160,right:220,top:100,bottom:120,width:60,height:20},{left:40,right:120,top:140,bottom:160,width:80,height:20}]))');
  assert.equal((outline.match(/M/g)||[]).length,1);assert.ok(outline.endsWith('Z'));assert.doesNotMatch(outline,/NaN|Infinity/);
 }finally{dom.window.close();}
});
test('a simple editable click retains a caret and Escape cancels word dragging',()=>{
 const {dom,w,pointer}=boot();try{
  pointer('pointerdown',30);pointer('mousedown',30);assert.ok(w.getSelection().isCollapsed);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));pointer('pointermove',100);assert.ok(w.getSelection().isCollapsed);
 }finally{dom.window.close();}
});
