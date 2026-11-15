const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const plan=(id,owner,extra={})=>({id,type:'plan',title:id==='auth'?'Auth refresh lease':'Session cleanup',body:'Goal\n\n1. Step — working',x:id==='auth'?80:700,y:80,width:420,revision:3,visualPlan:true,workItem:true,workStatus:'active',workOwnerId:owner,workOwner:{name:owner,color:'#6685cf'},workScope:{paths:['convex/auth.ts'],areas:['auth']},workLatest:[{kind:'decision',text:'Leases last 60s',at:1,source:'agent'}],contexts:[],...extra});
function boot(nodes){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://127.0.0.1:4387/app',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 w.matchMedia=()=>({matches:true,addEventListener(){}});w.ResizeObserver=class{observe(){}disconnect(){}};w.HTMLCanvasElement.prototype.getContext=()=>null;w.HTMLElement.prototype.getAnimations=()=>[];w.requestAnimationFrame=()=>1;w.document.fonts={ready:Promise.resolve()};
 w.localStorage.setItem('branch-workspace-v2',JSON.stringify({title:'Test',events:[],nodes}));
 for(const script of ['icons.js','media.js','work-scope.js','context.js','video-context.js','reactive-grid.js','auto-layout.js','app.js'])w.eval(fs.readFileSync(path.join(root,script),'utf8'));
 return dom;
}
const chat=contexts=>({id:'chat',type:'thread',title:'Ask',x:80,y:900,messages:[],contexts,draft:''});

test('a work card shows status, owner, scope and its latest update',()=>{
 const dom=boot([plan('auth','maria')]),d=dom.window.document;
 try{
  const card=d.querySelector('[data-node="auth"]');
  assert.ok(card.classList.contains('work-card'));
  assert.equal(card.querySelector('.work-strip').dataset.workStatus,'active');
  assert.match(card.querySelector('.work-status').textContent,/Active/);
  assert.match(card.querySelector('.work-strip').textContent,/maria/);
  assert.deepEqual([...card.querySelectorAll('.work-chip')].map(c=>c.textContent),['auth','convex/auth.ts']);
  assert.match(card.querySelector('.work-latest').textContent,/decision.*Leases last 60s/s);
  assert.equal(card.querySelector('.work-overlap'),null);
  // An ordinary note has none of this.
  assert.equal(d.querySelectorAll('.work-strip').length,1);
 }finally{dom.window.close();}
});
test('two people working in the same files see each other, and the badge appears when the other card arrives',()=>{
 const dom=boot([plan('auth','maria')]),w=dom.window,d=w.document;
 try{
  w.BranchHost.receive({title:'Test',nodes:[plan('auth','maria'),plan('sessions','eric',{workScope:{paths:['convex'],areas:['sessions']}}),plan('mine','maria',{title:'Same person',x:1300,workScope:{paths:['convex/auth.ts'],areas:[]}})]});
  const badge=d.querySelector('[data-node="auth"] .work-overlap');
  assert.ok(badge,'existing card re-rendered with an overlap badge');
  assert.equal(badge.dataset.workOverlap,'sessions');assert.match(badge.textContent,/Overlaps Session cleanup · eric in convex\/auth\.ts/);
  assert.equal(d.querySelectorAll('[data-node="auth"] .work-overlap').length,1,'a person never collides with their own work');
  assert.equal(d.querySelector('[data-node="sessions"] .work-overlap').dataset.workOverlap,'auth');
  // Finished work stops colliding.
  w.BranchHost.receive({title:'Test',nodes:[plan('auth','maria'),plan('sessions','eric',{workStatus:'done',workFinishedAt:Date.now(),workScope:{paths:['convex'],areas:['sessions']}})]});
  assert.equal(d.querySelector('[data-node="auth"] .work-overlap'),null);
  assert.match(d.querySelector('[data-node="sessions"] .work-status').textContent,/Done/);
 }finally{w.close();}
});
test('old finished work folds to a title row and expands on request',()=>{
 const dom=boot([plan('auth','maria',{workStatus:'done',workFinishedAt:Date.now()-2*86400000})]),d=dom.window.document;
 try{
  let card=d.querySelector('[data-node="auth"]');
  assert.ok(card.classList.contains('work-folded'));
  card.querySelector('[data-work-fold]').click();
  card=d.querySelector('[data-node="auth"]');
  assert.ok(!card.classList.contains('work-folded'));assert.equal(card.querySelector('[data-work-fold]').getAttribute('aria-expanded'),'true');
 }finally{dom.window.close();}
});
test('a followed connection shows what changed since its snapshot and can stop following',()=>{
 const dom=boot([plan('auth','maria'),chat([])]),w=dom.window,d=w.document;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 try{
  const binding={...w.BranchContext.snapshotNode(plan('auth','maria'),[plan('auth','maria')]),follow:true};
  assert.match(binding.body,/Leases last 60s/);
  // The source moves on: the chip goes stale and the inspector lists only what is new.
  w.BranchHost.receive({title:'Test',nodes:[plan('auth','maria',{revision:4,workLatest:[{kind:'decision',text:'Leases last 60s',at:1},{kind:'interface',text:'refreshSession returns leaseUntil',at:2}]}),chat([{...binding,id:'c1'}])]});
  const chip=d.querySelector('[data-context="c1"]');
  assert.ok(chip.classList.contains('stale'));assert.ok(chip.classList.contains('following'));assert.match(chip.title,/refreshes when you send/);
  chip.click();
  let dialog=d.querySelector('#context-inspector');
  const news=dialog.querySelector('.context-news');
  assert.match(news.textContent,/refreshSession returns leaseUntil/);assert.doesNotMatch(news.textContent,/Leases last 60s/);
  assert.match(dialog.querySelector('.inspector-snapshot-status').textContent,/refreshes when you send/);
  const toggle=dialog.querySelector('[data-inspector-follow]');
  assert.equal(toggle.checked,true);
  toggle.checked=false;toggle.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(JSON.parse(w.localStorage.getItem('branch-workspace-v2')).nodes.find(n=>n.id==='chat').contexts[0].follow,undefined);
  dialog=d.querySelector('#context-inspector');
  assert.equal(dialog.querySelector('[data-inspector-follow]').checked,false);
  assert.match(dialog.querySelector('.inspector-snapshot-status').textContent,/saved version shown/);
  assert.match(d.querySelector('[data-context="c1"]').title,/source updated/);
  // Refreshing by hand keeps the person's choice not to follow.
  dialog.querySelector('[data-inspector-refresh]').click();
  const refreshed=JSON.parse(w.localStorage.getItem('branch-workspace-v2')).nodes.find(n=>n.id==='chat').contexts[0];
  assert.equal(refreshed.follow,undefined);assert.equal(refreshed.revision,4);assert.match(refreshed.body,/refreshSession returns leaseUntil/);
  // An excerpt cannot follow.
  w.BranchHost.receive({title:'Test',nodes:[plan('auth','maria',{revision:4}),chat([{...binding,id:'c2',quote:'Leases',excerptOnly:true}])]});
  d.querySelector('[data-context="c2"]').click();
  assert.equal(d.querySelector('#context-inspector [data-inspector-follow]'),null);
 }finally{w.close();}
});
