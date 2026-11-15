const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');
function boot(reduced=false,savedDarkness=null){
 const dom=new JSDOM('<footer class="site-footer"><div id="footer-playground"><canvas></canvas><button>Draw</button></div><input id="footer-darkness" type="range" min="0" max="100"><output id="footer-darkness-value"></output><button id="nav-appearance-reset">Reset</button></footer>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://branch.test'});
 const w=dom.window,frames=new Map(),draws=[];let id=0,visibility;
 const ctx=new Proxy({}, {get(_,key){return (...args)=>draws.push({key,args});},set(){return true;}});
 w.HTMLCanvasElement.prototype.getContext=()=>ctx;
 w.matchMedia=()=>({matches:reduced,addEventListener(){}});
 w.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};w.cancelAnimationFrame=id=>frames.delete(id);
 w.ResizeObserver=class{observe(){}};w.IntersectionObserver=class{constructor(fn){visibility=fn;}observe(){}};
 const host=w.document.querySelector('#footer-playground');host.getBoundingClientRect=()=>({left:0,top:0,width:390,height:336});
 if(savedDarkness!==null)w.localStorage.setItem('branch.footer-darkness.v1',savedDarkness);
 w.eval(fs.readFileSync(path.resolve(__dirname,'../landing-footer.js'),'utf8'));
 function pointer(type,x,y,pointerType='mouse'){const event=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{clientX:x,clientY:y,pointerType,isPrimary:true});host.dispatchEvent(event);return event;}
 function tick(time){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));}
 return {dom,w,host,frames,draws,pointer,tick,visibility};
}
test('hover draws connected grid points and the animation sleeps after retraction',()=>{
 const b=boot();try{
 assert.equal(b.frames.size,0);
 b.pointer('pointermove',36,60);b.pointer('pointermove',180,84);b.tick(b.w.performance.now());
 assert.ok(b.draws.some(d=>d.key==='bezierCurveTo'));assert.ok(b.draws.some(d=>d.key==='roundRect'));assert.equal(b.frames.size,1);
 b.tick(b.w.performance.now()+2200);assert.equal(b.frames.size,0);assert.equal(b.host.dataset.engaged,'false');
 }finally{b.dom.window.close();}
});
test('touch taps create a branch while scrolling and cancellation do not draw',()=>{
 const b=boot();try{
 const down=b.pointer('pointerdown',180,130,'touch');assert.equal(down.defaultPrevented,false);assert.equal(b.frames.size,0);b.pointer('pointerup',180,130,'touch');b.tick(b.w.performance.now());
 assert.ok(b.draws.filter(d=>d.key==='bezierCurveTo').length>=3);
 b.pointer('pointercancel',180,130,'touch');b.tick(b.w.performance.now()+2200);
 b.pointer('pointermove',260,200,'touch');assert.equal(b.frames.size,0);
 b.pointer('pointerdown',180,130,'touch');b.pointer('pointermove',180,190,'touch');b.pointer('pointerup',180,190,'touch');assert.equal(b.frames.size,0);
 }finally{b.dom.window.close();}
});
test('keyboard button works with reduced motion and schedules no animation',()=>{
 const b=boot(true);try{
 b.host.querySelector('button').click();assert.ok(b.draws.some(d=>d.key==='roundRect'));assert.equal(b.frames.size,0);
 b.visibility([{isIntersecting:false}]);assert.equal(b.frames.size,0);
 }finally{b.dom.window.close();}
});

test('trail holds briefly and retracts oldest points in sequence',()=>{
 const b=boot();try{
 b.pointer('pointermove',48,80);b.pointer('pointermove',176,80);
 const start=b.w.performance.now();
 function points(time){b.draws.length=0;b.tick(time);return b.draws.filter(d=>d.key==='roundRect').map(d=>d.args[0]+d.args[2]/2);}
 assert.deepEqual(points(start),[64,96,128,160,192]);
 assert.deepEqual(points(start+400),[64,96,128,160,192]);
 assert.deepEqual(points(start+650),[96,128,160,192]);
 assert.deepEqual(points(start+700),[128,160,192]);
 }finally{b.dom.window.close();}
});
test('footer darkness previews, saves and resets independently of page theme',()=>{
 const b=boot();try{
 const footer=b.host.closest('footer'),slider=b.w.document.getElementById('footer-darkness');
 assert.equal(slider.value,'85');
 const initial=footer.style.getPropertyValue('--footer-bg');
 slider.value='30';slider.dispatchEvent(new b.w.Event('input'));
 assert.notEqual(footer.style.getPropertyValue('--footer-bg'),initial);
 assert.equal(b.w.document.getElementById('footer-darkness-value').value,'30%');
 slider.dispatchEvent(new b.w.Event('change'));
 assert.equal(b.w.localStorage.getItem('branch.footer-darkness.v1'),'30');
 assert.equal(b.w.document.documentElement.dataset.theme,undefined);
 b.w.document.getElementById('nav-appearance-reset').click();
 assert.equal(slider.value,'85');assert.equal(footer.style.getPropertyValue('--footer-bg'),initial);
 assert.equal(b.w.localStorage.getItem('branch.footer-darkness.v1'),'85');
 }finally{b.dom.window.close();}
});
test('saved darkness survives reload and is clamped to the slider range',()=>{
 for(const [saved,expected] of [['30','30'],['200','100'],['bad','85']]){
 const b=boot(false,saved);try{assert.equal(b.w.document.getElementById('footer-darkness').value,expected);}finally{b.dom.window.close();}
 }
});

test('points sit between background dots and smoothly grow before retracting',()=>{
 const b=boot();try{
 b.pointer('pointermove',61,63); const start=b.w.performance.now();
 function radius(time){b.draws.length=0;b.tick(time);return b.draws.find(d=>d.key==='roundRect').args;}
 const first=radius(start),settled=radius(start+180),retiring=radius(start+540);
 assert.equal((first[0]+first[2]/2)%32,0);assert.equal((first[1]+first[3]/2)%32,0);
 assert.ok(first[2]<settled[2]);assert.equal(settled[2],20);
 assert.ok(retiring[2]>0 && retiring[2]<20);
 }finally{b.dom.window.close();}
});

test('edge tracking keeps entire blocks inside the canvas',()=>{
 const b=boot();try{
 for(const [x,y] of [[0,0],[64,0],[64,32],[64,0],[390,0],[390,64],[352,64],[0,64],[32,64]]) b.pointer('pointermove',x,y);
 b.tick(b.w.performance.now()+180);
 const blocks=b.draws.filter(d=>d.key==='roundRect');assert.ok(blocks.length>0);
 for(const {args:[x,y,w,h]} of blocks){assert.ok(x>=0 && y>=0 && x+w<=390 && y+h<=336);}
 }finally{b.dom.window.close();}
});
