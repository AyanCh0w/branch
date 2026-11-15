const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const script=fs.readFileSync(require('node:path').join(__dirname,'../canvas-tour.js'),'utf8');
function boot(){const dom=new JSDOM('<button id="origin">Account</button><span class="dock-agent-avatar"><img src="/agent.svg"></span>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.eval(script);return {dom,w,d:w.document,tour:w.BranchCanvasTour,click:a=>w.document.querySelector(`[data-tour="${a}"]`).click()};}
test('all slides complete and the guide replays on every canvas visit',()=>{const {dom,w,d,tour,click}=boot();try{assert.equal(tour.start({}),false);assert.equal(tour.start({userId:'one'}),true);assert.equal(d.querySelector('.tour-guide img').getAttribute('src'),'/agent.svg');assert.equal(d.querySelector('[data-tour=back]').disabled,true);for(let i=0;i<5;i++)click('next');assert.equal(d.querySelector('[data-tour=next]').textContent,'Let’s build');click('back');assert.equal(d.querySelector('.tour-count').textContent,'5 of 6');click('next');click('next');assert.equal(d.querySelector('dialog').open,false);assert.equal(tour.start({userId:'one'}),true);click('skip');assert.equal(tour.start({userId:'one',force:true}),true);click('skip');assert.equal(tour.start({userId:'two'}),true);}finally{dom.window.close();}});
test('navigation cleanup and Escape both allow the next visit to replay',()=>{const {dom,w,d,tour}=boot();try{d.querySelector('#origin').focus();tour.start({userId:'one'});tour.dismiss();assert.equal(d.activeElement.id,'origin');assert.equal(tour.start({userId:'one'}),true);d.querySelector('dialog').dispatchEvent(new w.Event('cancel',{cancelable:true}));assert.equal(tour.start({userId:'one'}),true);}finally{dom.window.close();}});
test('no tour on account screens; view-only and blocked storage are supported',()=>{const {dom,w,d,tour,click}=boot();try{d.body.classList.add('account-mode');assert.equal(tour.start({userId:'one'}),false);d.body.classList.remove('account-mode');Object.defineProperty(w,'localStorage',{get(){throw Error('blocked');}});assert.equal(tour.start({userId:'one',role:'viewer'}),true);assert.match(d.querySelector('#canvas-tour-copy').textContent,/view-only/);click('skip');assert.equal(tour.start({userId:'one'}),true);}finally{dom.window.close();}});
test('tour keyboard input does not reach canvas shortcuts',()=>{const {dom,w,d,tour}=boot();try{let bubbled=false;d.addEventListener('keydown',()=>bubbled=true);tour.start({userId:'one'});d.querySelector('dialog').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(d.querySelector('.tour-count').textContent,'2 of 6');assert.equal(bubbled,false);}finally{dom.window.close();}});
test('tour cleans up examples, highlights and restores the exact starting camera',()=>{
 const {dom,w,d,tour,click}=boot();try{
 const start={x:123,y:-67,z:.65};let view={...start};w.BranchHost={captureView:()=>({...view}),setView:v=>{view={...v};}};
 w.requestAnimationFrame=()=>1;w.cancelAnimationFrame=()=>{};
 d.body.insertAdjacentHTML('beforeend','<main id="board"><div id="world"><div id="cards"></div></div></main><button data-dock="agent"></button>');
 tour.start({userId:'one'});assert.ok(d.querySelector('[data-tour-example=brief]').classList.contains('tour-highlight'));assert.equal(d.querySelector('.tour-samples').dataset.scene,'brief');
 click('next');click('next');assert.equal(d.querySelectorAll('.tour-samples').length,1);assert.equal(d.querySelector('#cards').children.length,0);
 view={x:500,y:800,z:1.18};click('skip');assert.deepEqual(view,start);assert.equal(d.querySelectorAll('.tour-samples,.tour-highlight').length,0);
 }finally{dom.window.close();}
});
test('the story starts on a brief and reveals team threads without modifying existing cards',()=>{
 const {dom,d,tour,click}=boot();try{
 d.body.insertAdjacentHTML('beforeend','<div id="world"><div id="cards"><article class="card"><span class="nib"></span><p>Existing work</p></article></div></div>');
 const original=d.querySelector('#cards').innerHTML;
 tour.start({userId:'one'});assert.equal(d.querySelector('.tour-samples').dataset.scene,'brief');assert.equal(d.querySelector('#canvas-tour-title').textContent,'Start with one shared node.');
 assert.equal(d.querySelectorAll('.tour-thread').length,3);click('next');assert.equal(d.querySelector('.tour-samples').dataset.scene,'overview');assert.match(d.querySelector('#canvas-tour-copy').textContent,/Everyone’s threads/);
 click('next');assert.ok(d.querySelector('[data-tour-example=brief] .tour-example-nib').classList.contains('tour-highlight'));
 click('next');assert.ok(d.querySelector('[data-tour-example=plan]').classList.contains('tour-highlight'));
 tour.dismiss();assert.equal(d.querySelector('#cards').innerHTML,original);assert.equal(d.querySelectorAll('.tour-samples,.tour-highlight').length,0);
 }finally{dom.window.close();}
});
