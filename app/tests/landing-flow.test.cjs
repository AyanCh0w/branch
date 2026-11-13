const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
function boot(reduced=false){
 const root=path.resolve(__dirname,'..');
 const dom=new JSDOM(fs.readFileSync(path.join(root,'landing.html'),'utf8'),{url:'http://127.0.0.1:4387',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,observers=[],frames=new Map();let now=0,id=0;
 w.matchMedia=query=>({matches:query.includes('reduced-motion')&&reduced,addEventListener(){}});
 w.IntersectionObserver=class{constructor(cb){this.cb=cb;observers.push(this);}observe(el){this.el=el;}unobserve(){}};
 w.ResizeObserver=class{observe(){}};
 w.requestAnimationFrame=cb=>{frames.set(++id,cb);return id;};w.cancelAnimationFrame=id=>frames.delete(id);
 w.document.fonts={ready:Promise.resolve()};
 w.eval(fs.readFileSync(path.join(root,'landing.js'),'utf8'));
 const flowObserver=observers.find(o=>o.el?.matches('.flow-demo'));
 const visible=value=>flowObserver.cb([{target:flowObserver.el,isIntersecting:value}]);
 visible(true);
 const advance=ms=>{for(let elapsed=0;elapsed<ms;elapsed+=20){now+=20;const pending=[...frames.values()];frames.clear();pending.forEach(cb=>cb(now));}};
 return {dom,d:w.document,advance,visible};
}
test('hero types before sending, reveals an answer, drags before creating branches, then loops',()=>{
 const {dom,d,advance}=boot();try{
  const flow=d.querySelector('.flow-demo');
  advance(2200);assert.equal(flow.dataset.phase,'typing');
  const partial=d.querySelector('.demo-draft').textContent;assert.ok(partial.length>5);assert.ok(partial.length<55);
  assert.equal(d.querySelector('.flow-question').getAttribute('aria-hidden'),'true');
  advance(3000);assert.equal(flow.dataset.phase,'answering');
  const shown=d.querySelectorAll('.word-visible').length;assert.ok(shown>0&&shown<d.querySelectorAll('.demo-word').length);
  advance(3200);assert.equal(flow.dataset.phase,'dragging');assert.equal(d.querySelector('.plan-node').getAttribute('aria-hidden'),'true');assert.equal(d.querySelector('.demo-pointer').hidden,false);
  advance(2300);assert.equal(flow.dataset.phase,'holding');assert.equal(d.querySelector('.plan-node').getAttribute('aria-hidden'),'false');
  advance(2000);assert.equal(flow.dataset.phase,'holding');
  advance(1300);assert.equal(flow.dataset.stage,'0');
 }finally{dom.window.close();}
});
test('pause and offscreen suspension preserve progress instead of skipping the typing',()=>{
 const {dom,d,advance,visible}=boot();try{
  advance(2200);const draft=d.querySelector('.demo-draft').textContent;
  d.querySelector('.flow-play').click();advance(4000);assert.equal(d.querySelector('.demo-draft').textContent,draft);
  d.querySelector('.flow-play').click();advance(300);assert.ok(d.querySelector('.demo-draft').textContent.length>draft.length);
  visible(false);const paused=d.querySelector('.demo-draft').textContent;advance(10000);assert.equal(d.querySelector('.demo-draft').textContent,paused);
  visible(true);advance(200);assert.ok(d.querySelector('.demo-draft').textContent.length>paused.length);
 }finally{dom.window.close();}
});
test('reduced motion starts completed and does not autoplay',()=>{
 const {dom,d,advance}=boot(true);try{
  assert.equal(d.querySelector('.flow-demo').dataset.phase,'holding');assert.equal(d.querySelector('.flow-play').hidden,true);
  advance(18000);assert.equal(d.querySelector('.flow-demo').dataset.phase,'holding');
  d.querySelector('[data-flow-step="1"]').click();assert.equal(d.querySelector('.flow-question').getAttribute('aria-hidden'),'false');
 }finally{dom.window.close();}
});
