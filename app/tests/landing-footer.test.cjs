const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');
function boot(reduced=false){
 const dom=new JSDOM('<footer class="site-footer"><div id="footer-playground"><canvas></canvas><button>Draw</button></div><button data-footer-tone-toggle>Dark footer</button></footer>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://branch.test'});
 const w=dom.window,frames=new Map(),draws=[];let id=0,visibility;
 const ctx=new Proxy({}, {get(_,key){return (...args)=>draws.push({key,args});},set(){return true;}});
 w.HTMLCanvasElement.prototype.getContext=()=>ctx;
 w.matchMedia=()=>({matches:reduced,addEventListener(){}});
 w.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};w.cancelAnimationFrame=id=>frames.delete(id);
 w.ResizeObserver=class{observe(){}};w.IntersectionObserver=class{constructor(fn){visibility=fn;}observe(){}};
 const host=w.document.querySelector('#footer-playground');host.getBoundingClientRect=()=>({left:0,top:0,width:390,height:336});
 w.eval(fs.readFileSync(path.resolve(__dirname,'../landing-footer.js'),'utf8'));
 function pointer(type,x,y,pointerType='mouse'){const event=new w.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{clientX:x,clientY:y,pointerType,isPrimary:true});host.dispatchEvent(event);return event;}
 function tick(time){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));}
 return {dom,w,host,frames,draws,pointer,tick,visibility};
}
test('hover draws connected grid points and the animation sleeps after retraction',()=>{
 const b=boot();try{
 assert.equal(b.frames.size,0);
 b.pointer('pointermove',36,60);b.pointer('pointermove',180,84);b.tick(b.w.performance.now());
 assert.ok(b.draws.some(d=>d.key==='bezierCurveTo'));assert.ok(b.draws.some(d=>d.key==='arc'));assert.equal(b.frames.size,1);
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
 b.host.querySelector('button').click();assert.ok(b.draws.some(d=>d.key==='arc'));assert.equal(b.frames.size,0);
 b.visibility([{isIntersecting:false}]);assert.equal(b.frames.size,0);
 }finally{b.dom.window.close();}
});

test('trail holds briefly and retracts oldest points in sequence',()=>{
 const b=boot();try{
 b.pointer('pointermove',48,80);b.pointer('pointermove',176,80);
 const start=b.w.performance.now();
 function points(time){b.draws.length=0;b.tick(time);return b.draws.filter(d=>d.key==='arc').map(d=>d.args[0]);}
 assert.deepEqual(points(start),[64,96,128,160,192]);
 assert.deepEqual(points(start+400),[64,96,128,160,192]);
 assert.deepEqual(points(start+650),[96,128,160,192]);
 assert.deepEqual(points(start+700),[128,160,192]);
 }finally{b.dom.window.close();}
});
test('footer tone defaults dark and toggles independently with a saved preference',()=>{
 const b=boot();try{
 const footer=b.host.closest('footer'),toggle=b.w.document.querySelector('[data-footer-tone-toggle]');
 assert.equal(footer.dataset.footerTone,'dark');assert.equal(toggle.getAttribute('aria-pressed'),'true');
 toggle.click();assert.equal(footer.dataset.footerTone,'light');assert.equal(b.w.localStorage.getItem('branch-footer-tone'),'light');
 toggle.click();assert.equal(footer.dataset.footerTone,'dark');assert.equal(b.w.document.documentElement.dataset.theme,undefined);
 }finally{b.dom.window.close();}
});

test('points sit between background dots and smoothly grow before retracting',()=>{
 const b=boot();try{
 b.pointer('pointermove',61,63); const start=b.w.performance.now();
 function radius(time){b.draws.length=0;b.tick(time);return b.draws.find(d=>d.key==='arc').args;}
 const first=radius(start),settled=radius(start+180),retiring=radius(start+540);
 assert.equal(first[0]%32,0);assert.equal(first[1]%32,0);
 assert.ok(first[2]<settled[2]);assert.equal(settled[2],12);
 assert.ok(retiring[2]>0 && retiring[2]<12);
 }finally{b.dom.window.close();}
});
