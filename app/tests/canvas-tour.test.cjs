const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const script=fs.readFileSync(require('node:path').join(__dirname,'../canvas-tour.js'),'utf8');
function boot(){const dom=new JSDOM('<button id="origin">Account</button><span class="dock-agent-avatar"><img src="/agent.svg"></span>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.eval(fs.readFileSync(require('node:path').join(__dirname,'../desktop-setup.js'),'utf8'));w.eval(script);return {dom,w,d:w.document,tour:w.BranchCanvasTour,click:a=>w.document.querySelector(`[data-tour="${a}"]`).click()};}
test('all slides complete once per user and explicit replay remains available',()=>{const {dom,w,d,tour,click}=boot();try{assert.equal(tour.start({}),false);assert.equal(tour.start({userId:'one'}),true);assert.equal(d.querySelector('.tour-guide img').getAttribute('src'),'/agent.svg');assert.equal(d.querySelector('[data-tour=back]').disabled,true);for(let i=0;i<6;i++)click('next');assert.equal(d.querySelector('[data-tour=next]').textContent,'Let’s build');click('back');assert.equal(d.querySelector('.tour-count').textContent,'6 of 7');click('next');click('next');assert.equal(d.querySelector('dialog').open,false);assert.equal(tour.start({userId:'one'}),false);assert.equal(tour.start({userId:'one',force:true}),true);click('skip');assert.equal(tour.start({userId:'two'}),true);}finally{dom.window.close();}});
test('navigation cleanup and Escape do not replay on the next visit',()=>{const {dom,w,d,tour}=boot();try{d.querySelector('#origin').focus();tour.start({userId:'one'});tour.dismiss();assert.equal(d.activeElement.id,'origin');assert.equal(tour.start({userId:'one'}),false);assert.equal(tour.start({userId:'one',force:true}),true);d.querySelector('dialog').dispatchEvent(new w.Event('cancel',{cancelable:true}));assert.equal(tour.start({userId:'one'}),false);}finally{dom.window.close();}});
test('no tour on account screens; view-only and blocked storage are supported',()=>{const {dom,w,d,tour,click}=boot();try{d.body.classList.add('account-mode');assert.equal(tour.start({userId:'one'}),false);d.body.classList.remove('account-mode');Object.defineProperty(w,'localStorage',{get(){throw Error('blocked');}});assert.equal(tour.start({userId:'one',role:'viewer'}),true);assert.match(d.querySelector('#canvas-tour-copy').textContent,/view-only/);click('skip');assert.equal(tour.start({userId:'one'}),false);}finally{dom.window.close();}});
test('tour keyboard input does not reach canvas shortcuts',()=>{const {dom,w,d,tour}=boot();try{let bubbled=false;d.addEventListener('keydown',()=>bubbled=true);tour.start({userId:'one'});d.querySelector('dialog').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(d.querySelector('.tour-count').textContent,'2 of 7');assert.equal(bubbled,false);}finally{dom.window.close();}});
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

test('compatibility diagnostics remain separate from installation and Chrome settings', async () => {
 const {dom,w,d,tour,click}=boot();
 try {
  const {prompt}=require('../../desktop/Sources/BranchDesktopProbe/Resources/desktop-baseline.json');
  let copied, opened=false;
  Object.defineProperty(w.navigator,'clipboard',{value:{async writeText(value){copied=value;}}});
  const chrome=d.createElement('button');chrome.setAttribute('data-open-chrome-sync','');
  chrome.addEventListener('click',()=>{assert.equal(d.querySelector('dialog').open,false);opened=true;});
  d.body.append(chrome);
  tour.setBaselinePrompt(prompt);
  tour.start({userId:'one'});
  click('connections');
  assert.equal(d.querySelector('[data-baseline]').value,prompt);
  click('copy-baseline');
  await new Promise(setImmediate);
  assert.equal(copied,prompt);
  assert.match(d.querySelector('.tour-connection-status').textContent,/copied/);
  click('chrome');
  assert.equal(opened,true);
  assert.equal(tour.start({userId:'one',force:true,scene:'connections'}),true);
  assert.equal(d.querySelector('#canvas-tour-title').textContent,'Connect an agent.');
 } finally {dom.window.close();}
});

test('Claude Code setup can open on an empty board and viewers cannot open it', () => {
 const {dom,w,d,tour,click}=boot();
 try {
  const coding=fs.readFileSync(require('node:path').join(__dirname,'../coding.js'),'utf8');
  w.BranchHost={getState:()=>({nodes:[]})};
  w.BoardShared={writable:true,coding:{}};
  w.eval(coding);
  w.BranchCoding.update({connected:false,handoffs:[],endpoint:'http://localhost/api/backend?coding'});
  tour.start({userId:'one',scene:'connections'});
  d.querySelector('[data-provider="claude"]').click();
  click('claude');
  assert.equal(d.querySelector('#canvas-tour').open,false);
  assert.equal(d.querySelector('.coding-dialog').open,true);
  assert.match(d.querySelector('.coding-body').textContent,/Create connection key/);
  w.BranchCoding.sync();
  assert.equal(d.querySelector('.coding-dialog').open,true);
  w.BranchCoding.reset();w.BoardShared.writable=false;
  tour.start({userId:'viewer',role:'viewer',scene:'connections'});
  d.querySelector('[data-provider="claude"]').click();
  assert.equal(d.querySelector('[data-tour="claude"]').hidden,true);
  click('claude');
  assert.equal(d.querySelector('.coding-dialog'),null);
 } finally {dom.window.close();}
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

test('seen state survives a fresh page load',()=>{const first=boot(),second=boot();try{first.tour.start({userId:'one'});first.click('skip');for(let i=0;i<first.w.localStorage.length;i++){const key=first.w.localStorage.key(i);second.w.localStorage.setItem(key,first.w.localStorage.getItem(key));}assert.equal(second.tour.start({userId:'one'}),false);assert.equal(second.tour.start({userId:'two'}),true);}finally{first.dom.window.close();second.dom.window.close();}});

test('installation handoff contains setup and only the board destination, not URL credentials',async()=>{
 const {dom,w,d,tour,click}=boot();try{
  w.history.replaceState({},'', '/?board=boards_test&token=private-test-token#secret');
  let copied;Object.defineProperty(w.navigator,'clipboard',{value:{async writeText(value){copied=value;}}});
  tour.start({userId:'one',scene:'connections'});click('copy-setup');await new Promise(setImmediate);
  assert.match(copied,/https:\/\/joinbranch.dev\/mac-setup.html/);
  assert.match(copied,/software catalog or IT/);
  assert.match(copied,/https:\/\/joinbranch.dev\/app\?board=boards_test/);assert.doesNotMatch(copied,/private-test-token|#secret|branch_desktop_launch_/);
  assert.match(copied,/#mac-sync=open/);
  assert.match(copied,/this chat’s exact title/);assert.match(copied,/Open Branch for Mac/);assert.match(copied,/ChatGPT desktop app/);
  assert.doesNotMatch(copied,/github|swift|build-probe|checkout|pairing prompt|baseline prompt/i);
  assert.equal(d.querySelector('details').open,false);assert.equal(d.querySelector('[data-setup-fallback]').hidden,true);
  assert.equal(d.querySelector('[data-tour="copy-setup"]').textContent,'✓ Copied to clipboard');
  assert.match(d.querySelector('.tour-connection-status').textContent,/Paste the instructions/);
 }finally{dom.window.close();}
});
test('Mac launch link encodes the selected chat and keeps the launch ticket out of copied setup',()=>{
 const {appURL,handoff}=require('../desktop-setup');
 const ticket='branch_desktop_launch_1234567890123_'+'a'.repeat(64);
 const launch=appURL('boards_test',{ticket,chatTitle:'Current chat & notes'});
 assert.equal(launch,'joinbranch://connect?board=boards_test&ticket='+ticket+'&chat=Current%20chat%20%26%20notes');
 assert.doesNotMatch(handoff('boards_test'),/branch_desktop_launch_/);
 assert.doesNotMatch(appURL(undefined,{ticket}),/ticket/);
});
test('clipboard failure exposes selectable installation instructions',async()=>{
 const {dom,w,d,tour,click}=boot();try{
  Object.defineProperty(w.navigator,'clipboard',{value:{async writeText(){throw Error('denied');}}});
  tour.start({userId:'one',scene:'connections'});click('copy-setup');await new Promise(setImmediate);
  const field=d.querySelector('[data-setup-fallback]');assert.equal(field.hidden,false);assert.match(field.value,/Help me connect this conversation/);
  const count=d.querySelector('.tour-count').textContent;field.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.equal(d.querySelector('.tour-count').textContent,count);
 }finally{dom.window.close();}
});

test('employee setup shows a download only when the first-party installer is published',async()=>{
 const markup=fs.readFileSync(require.resolve('../mac-setup.html'),'utf8');
 const setupScript=fs.readFileSync(require.resolve('../mac-setup.js'),'utf8');
 const linkScript=fs.readFileSync(require.resolve('../desktop-setup.js'),'utf8');
 assert.doesNotMatch(markup,/github|Swift|developer preview|build scripts/i);
 for(const manifest of [null,{installer:'https://elsewhere.example/installer.dmg'},{installer:'/downloads/branch-for-mac.dmg'}]){
  const dom=new JSDOM(markup,{url:'https://joinbranch.dev/mac-setup.html?board=boards_test',runScripts:'outside-only'});
  try{
   const {window:w}=dom;
   w.fetch=async url=>{
    assert.equal(url,'/downloads/mac-release.json');
    return {ok:!!manifest,json:async()=>manifest};
   };
   w.eval(linkScript);
   w.eval(setupScript);
   await new Promise(setImmediate);
   const published=manifest?.installer==='/downloads/branch-for-mac.dmg';
   assert.equal(w.document.getElementById('direct-install').hidden,!published);
   assert.equal(w.document.getElementById('managed-install').hidden,published);
   assert.equal(w.document.getElementById('open-mac').href,'https://joinbranch.dev/app?board=boards_test#mac-sync=open');
  }finally{dom.window.close();}
 }
});
