'use strict';
// Preserve previously issued hash-based invites when / is the public website.
if (new URLSearchParams(location.hash.slice(1)).has('join')) {
  location.replace('/app' + location.search + location.hash);
}
const demo = document.querySelector('.branch-demo');
const choices = [...document.querySelectorAll('[data-pick]')];
const explanations = [
  'Sam builds the React interface with the shared brief and API contract already in context.',
  'Maya writes the Convex API against the same contract while Sam builds the frontend.',
  'Alex writes contract tests in a separate branch with the shared architecture already attached.'
];
function selectBranch(index, keyboard = false) {
  demo.classList.toggle('keyboard-change', keyboard);
  demo.dataset.active = String(index);
  choices.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  document.querySelectorAll('[data-branch]').forEach((card, i) => card.classList.toggle('selected', i === index));
  demo.querySelector('.branch-explanation').textContent = explanations[index];
}
choices.forEach((button, index) => button.addEventListener('click', event => selectBranch(index, event.detail === 0)));
selectBranch(0);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      if (!reducedMotion.matches) entry.target.classList.add('play');
      observer.unobserve(entry.target);
    });
  }, {threshold: .25});
  document.querySelectorAll('.diagram').forEach(diagram => observer.observe(diagram));
}

const compactDiagram = matchMedia('(max-width: 540px)');
function sizeDiagram() {
  demo.querySelector('svg').setAttribute('viewBox', compactDiagram.matches ? '0 0 320 265' : '0 0 960 265');
}
compactDiagram.addEventListener('change', sizeDiagram);
sizeDiagram();

// A deterministic demo timeline: pause preserves typing and drag progress exactly.
const flow = document.querySelector('.flow-demo');
const flowButtons = [...flow.querySelectorAll('[data-flow-step]')];
const playButton = flow.querySelector('.flow-play');
const question = flow.querySelector('.flow-question');
const answer = flow.querySelector('.flow-answer');
const draft = flow.querySelector('.demo-draft');
const pointer = flow.querySelector('.demo-pointer');
const liveWire = flow.querySelector('.live-branch-wire');
const questionText = question.querySelector('p').textContent;
const answerHeading = answer.querySelector('h3');
const answerBody = answer.querySelector('p');
const answerWords = [];
for (const el of [answerHeading, answerBody]) {
  const words = el.textContent.split(' ');
  el.replaceChildren(...words.map((word,i) => {
    const span = document.createElement('span');
    span.className = 'demo-word'; span.textContent = word + (i < words.length - 1 ? ' ' : '');
    answerWords.push(span); return span;
  }));
}
const flowCaptions = [
  'Maya adds the project brief and shared API contract.',
  'Alex plans the architecture with both sources already connected.',
  'The team agrees on one contract before splitting the implementation.',
  'Frontend, backend, and tests move forward in parallel with the same shared context.'
];
const checkpoints = [0, 3900, 7400, 13000];
const codeSamples=[...flow.querySelectorAll('[data-demo-code]')].map(el=>({el,text:el.textContent,count:-1}));
const loopDuration = 15500; // Includes a 3.1-second hold on the completed board.
let flowStage = -1, flowPlaying = false, flowVisible = false, flowStarted = false;
let playhead = 0, frame = null, lastFrame = null, points = {}, lastTyped = -1, lastWords = -1;
function curve(a,b) {
  if (matchMedia('(max-width: 540px)').matches)
    return `M${a.x} ${a.y} C${a.x} ${a.y+24},${b.x} ${b.y-24},${b.x} ${b.y}`;
  const bend = Math.max(25,Math.abs(b.x-a.x)*.5);
  return `M${a.x} ${a.y} C${a.x+bend} ${a.y},${b.x-bend} ${b.y},${b.x} ${b.y}`;
}
function drawFlowWires() {
  const rect = flow.querySelector('.flow-canvas').getBoundingClientRect();
  flow.querySelectorAll('[data-port]').forEach(port => {
    const r=port.getBoundingClientRect();
    points[port.dataset.port]={x:r.left+r.width/2-rect.left,y:r.top+r.height/2-rect.top};
  });
  for (const [name,from,to] of [['source','source','input'],['interviews','interviews','input'],['branch','answer','branch'],['second','answer','second'],['third','answer','third']])
    flow.querySelector(`[data-wire="${name}"]`).setAttribute('d',curve(points[from],points[to]));
  renderFlow(playhead);
}
function reveal(el, visible) {
  el.classList.toggle('not-yet',!visible);
  el.setAttribute('aria-hidden',String(!visible));
}
function renderFlow(time) {
  const stage = time < 1300 ? 0 : time < 4400 ? 1 : time < 7900 ? 2 : 3;
  if(stage !== flowStage) {
    flowStage=stage; flow.dataset.stage=String(stage);
    flowButtons.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===stage)));
    flow.querySelector('#flow-caption').textContent=flowCaptions[stage];
  }
  const typing=time>=1300 && time<3700;
  flow.classList.toggle('is-typing',typing);
  flow.classList.toggle('is-generating',time>=4400 && time<7000);
  const count=typing?Math.min(questionText.length,Math.floor((time-1300)/2100*questionText.length)):-1;
  if(count!==lastTyped){draft.textContent=typing?questionText.slice(0,count):'Keep building together…';lastTyped=count;}
  reveal(question,time>=3700);
  reveal(answer,time>=4400);
  const wordCount=Math.max(0,Math.min(answerWords.length,Math.floor((time-4400)/2300*answerWords.length)));
  if(wordCount!==lastWords){answerWords.forEach((word,i)=>word.classList.toggle('word-visible',i<wordCount));lastWords=wordCount;}
  reveal(flow.querySelector('.teammate-reply'),time>=10000);
  reveal(flow.querySelector('.plan-node'),time>=9300);
  reveal(flow.querySelector('.design-node'),time>=9700);
  reveal(flow.querySelector('.qa-node'),time>=10000);
  codeSamples.forEach((sample,i)=>{const count=Math.max(0,Math.min(sample.text.length,Math.floor((time-(9300+i*350))/2200*sample.text.length)));if(count!==sample.count){sample.el.textContent=sample.text.slice(0,count);sample.count=count;}});
  reveal(flow.querySelector('.flow-composer>div'),time>=800);
  for(const name of ['source','interviews']) reveal(flow.querySelector(`[data-wire="${name}"]`),time>=800);
  reveal(flow.querySelector('[data-wire="branch"]'),time>=9300);
  reveal(flow.querySelector('[data-wire="second"]'),time>=9700);
  reveal(flow.querySelector('[data-wire="third"]'),time>=10000);
  const dragging=time>=7900 && time<9300;
  flow.classList.toggle('is-branch-dragging',dragging);
  pointer.hidden=!dragging;
  liveWire.style.opacity=dragging?'1':'0';
  if(dragging && points.answer && points.branch){
    // Start on the actual answer nib; the new card appears only after release.
    const progress=Math.max(0,Math.min(1,(time-8150)/1050));
    const eased=progress*progress*(3-2*progress);
    const a=points.answer,b=points.branch;
    const cursor={x:a.x+(b.x-a.x)*eased,y:a.y+(b.y-a.y)*eased};
    pointer.style.transform=`translate(${cursor.x}px,${cursor.y}px)`;
    pointer.querySelector('span').textContent=progress===0?'Sam grabs a branch':'Sam';
    liveWire.setAttribute('d',curve(a,cursor));
  }
  flow.querySelector('.demo-send').classList.toggle('sending',time>=3500 && time<3900);
  flow.dataset.phase=typing?'typing':dragging?'dragging':time>=10000?'holding':time>=4400&&time<7000?'answering':'ready';
}
function updatePlayback() {
  playButton.hidden=reducedMotion.matches;
  playButton.textContent=flowPlaying?'Pause Ⅱ':'Play ▷';
  playButton.setAttribute('aria-label',flowPlaying?'Pause example animation':'Play collaboration example');
}
function tick(now) {
  if(!flowPlaying||!flowVisible||document.hidden){frame=null;lastFrame=null;return;}
  if(lastFrame!==null)playhead=(playhead+Math.min(now-lastFrame,80))%loopDuration;
  lastFrame=now;renderFlow(playhead);frame=requestAnimationFrame(tick);
}
function syncPlayback() {
  if(frame!==null)cancelAnimationFrame(frame);
  frame=null;lastFrame=null;
  if(flowPlaying&&flowVisible&&!document.hidden)frame=requestAnimationFrame(tick);
  updatePlayback();
}
flow.classList.add('is-ready','app-like-flow');
playhead=reducedMotion.matches?13000:0;
renderFlow(playhead);
flowButtons.forEach((button,index)=>button.addEventListener('click',()=>{
  flowStarted=true;flowPlaying=false;playhead=checkpoints[index];
  flow.classList.add('keyboard-change');renderFlow(playhead);syncPlayback();
}));
playButton.addEventListener('click',()=>{
  flowStarted=true;
  if(reducedMotion.matches){playhead=playhead>=13000?0:13000;renderFlow(playhead);return;}
  flow.classList.remove('keyboard-change');flowPlaying=!flowPlaying;syncPlayback();
});
const flowObserver=new IntersectionObserver(entries=>{
  flowVisible=entries[0].isIntersecting;
  if(flowVisible&&!flowStarted){flowStarted=true;flowPlaying=!reducedMotion.matches;}
  syncPlayback();
},{threshold:.2});
flowObserver.observe(flow);
new ResizeObserver(drawFlowWires).observe(flow.querySelector('.flow-canvas'));
document.fonts.ready.then(drawFlowWires);
document.addEventListener('visibilitychange',syncPlayback);
reducedMotion.addEventListener('change',event=>{
  if(event.matches){flowPlaying=false;playhead=13000;renderFlow(playhead);syncPlayback();}
});
updatePlayback();
choices.forEach(button=>button.addEventListener('click',event=>{
  demo.classList.remove('user-play');
  if(event.detail&&!reducedMotion.matches)requestAnimationFrame(()=>demo.classList.add('user-play'));
}));

// A critically damped spring retains momentum when scrolling changes direction.
const siteHeader = document.querySelector('.site-header');
let navFrame = null, navTime = null, navVelocity = 0;
let navDock = reducedMotion.matches ? 1 : navTarget();
let navShoulder = 40;
function navTarget() {
  const progress = Math.max(0, Math.min(1, window.scrollY / 180));
  return progress * progress * (3 - 2 * progress);
}
function renderNavDock() {
  siteHeader.style.setProperty('--dock', String(navDock));
  // One silhouette keeps the wider, concave shoulders seamless with the glass body.
  const inset = navShoulder, width = siteHeader.offsetWidth + inset * 2;
  const height = siteHeader.offsetHeight, radius = 28 + 4 * navDock;
  const topX = (inset + radius) * (1 - navDock);
  const topY = 28 + 4 * navDock;
  const right = width - inset;
  const outline = `M ${topX} 0 H ${width-topX} Q ${right} 0 ${right} ${topY} V ${height-radius} Q ${right} ${height} ${right-radius} ${height} H ${inset+radius} Q ${inset} ${height} ${inset} ${height-radius} V ${topY} Q ${inset} 0 ${topX} 0 Z`;
  siteHeader.style.setProperty('--nav-silhouette', `path("${outline}")`);
}
function animateNavDock(now) {
  const target = navTarget();
  const dt = navTime === null ? 1 / 60 : Math.min((now - navTime) / 1000, .05);
  navTime = now;
  const omega = 22, delta = navDock - target;
  const impulse = navVelocity + omega * delta, decay = Math.exp(-omega * dt);
  navDock = target + (delta + impulse * dt) * decay;
  navVelocity = (navVelocity - omega * impulse * dt) * decay;
  if (Math.abs(navDock-target) < .0001 && Math.abs(navVelocity) < .001) {
    navDock = target; navVelocity = 0; navFrame = null; navTime = null;
  } else {
    navFrame = requestAnimationFrame(animateNavDock);
  }
  renderNavDock();
}
function updateNavDock() {
  if (reducedMotion.matches) {
    if (navFrame !== null) cancelAnimationFrame(navFrame);
    navFrame = null; navTime = null; navVelocity = 0; navDock = 1;
    renderNavDock();
  } else if (navFrame === null) {
    navFrame = requestAnimationFrame(animateNavDock);
  }
}
function measureNavDock() {
  navShoulder = parseFloat(getComputedStyle(siteHeader).getPropertyValue('--shoulder')) || 40;
  renderNavDock(); updateNavDock();
}
window.addEventListener('scroll', updateNavDock, {passive:true});
window.addEventListener('pageshow', measureNavDock);
window.addEventListener('resize', measureNavDock);
document.fonts.ready.then(measureNavDock);
reducedMotion.addEventListener('change', updateNavDock);
measureNavDock();

// Live, browser-local material preferences. Malformed or blocked storage is harmless.
(() => {
  const key = 'branch.nav-appearance.v1';
  const defaults = {tint:25, glass:70, tintOn:true, glassOn:true};
  let settings = {...defaults};
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    for (const name of ['tint','glass']) if (Number.isFinite(saved?.[name])) settings[name] = Math.max(0,Math.min(100,saved[name]));
    for (const name of ['tintOn','glassOn']) if (typeof saved?.[name] === 'boolean') settings[name] = saved[name];
  } catch {}
  const tint = document.getElementById('nav-tint');
  const glass = document.getElementById('nav-glass');
  const tintOn = document.getElementById('nav-tint-on');
  const glassOn = document.getElementById('nav-glass-on');
  function render() {
    tint.value = settings.tint; glass.value = settings.glass;
    tintOn.checked = settings.tintOn; glassOn.checked = settings.glassOn;
    tint.disabled = !settings.tintOn; glass.disabled = !settings.glassOn;
    document.getElementById('nav-tint-value').value = settings.tint + '%';
    document.getElementById('nav-glass-value').value = settings.glass + '%';
    const shade = 255 - Math.round((settings.tintOn ? settings.tint : 0) * .8);
    siteHeader.style.setProperty('--nav-tone', `${shade},${Math.min(255,shade+1)},${Math.min(255,shade+2)}`);
    siteHeader.style.setProperty('--nav-dark-tone', String(34 - Math.round((settings.tintOn ? settings.tint : 0) * .18)));
    siteHeader.style.setProperty('--nav-glass', settings.glassOn ? settings.glass / 100 : 0);
  }
  function save() { try { localStorage.setItem(key,JSON.stringify(settings)); } catch {} }
  for (const [input,name] of [[tint,'tint'],[glass,'glass']]) {
    input.addEventListener('input',() => {settings[name] = Number(input.value); render();});
    input.addEventListener('change',save);
  }
  for (const [input,name] of [[tintOn,'tintOn'],[glassOn,'glassOn']]) input.addEventListener('change',() => {settings[name] = input.checked; render(); save();});
  document.getElementById('nav-appearance-reset').addEventListener('click',() => {settings = {...defaults}; render(); save();});
  render();
})();

// Use the app's shared appearance preference for the landing's footer toggle.
(() => {
 const sync = () => document.querySelectorAll('[data-theme-toggle]').forEach(button => {
  const dark = document.documentElement.dataset.theme === 'dark';
  button.textContent = dark ? 'Light mode' : 'Dark mode';
  button.setAttribute('aria-label', 'Switch to ' + (dark ? 'light' : 'dark') + ' mode');
 });
 document.addEventListener('click', event => {
  if (event.target.closest('[data-theme-toggle]')) {
   window.BranchTheme.set(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  }
 });
 window.addEventListener('branch-appearance', sync);
 sync();
})();
