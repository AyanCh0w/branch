'use strict';
// Preserve previously issued hash-based invites when / is the public website.
if (new URLSearchParams(location.hash.slice(1)).has('join')) {
  location.replace('/app' + location.search + location.hash);
}
const demo = document.querySelector('.branch-demo');
const choices = [...document.querySelectorAll('[data-pick]')];
const explanations = [
  'Alex scopes a first version, with the team’s brief and brainstorm already in context.',
  'Maya explores the experience from the same brainstorm, without changing Alex’s direction.',
  'Sam shapes the pitch from the shared idea. Connect another branch when its thinking is useful.'
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
  'Maya brings the brief and interviews onto the team’s board.',
  'Alex asks in their shared chat, with both sources already connected.',
  'The answer appears for everyone in the same conversation.',
  'Sam drags out a branch. The brief, interviews, and conversation come along.'
];
const checkpoints = [0, 3900, 7400, 10600];
const loopDuration = 13700; // Includes a 3.1-second hold on the completed board.
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
  for (const [name,from,to] of [['source','source','input'],['interviews','interviews','input'],['branch','answer','branch'],['second','answer','second']])
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
  if(count!==lastTyped){draft.textContent=typing?questionText.slice(0,count):'Keep thinking together…';lastTyped=count;}
  reveal(question,time>=3700);
  reveal(answer,time>=4400);
  const wordCount=Math.max(0,Math.min(answerWords.length,Math.floor((time-4400)/2300*answerWords.length)));
  if(wordCount!==lastWords){answerWords.forEach((word,i)=>word.classList.toggle('word-visible',i<wordCount));lastWords=wordCount;}
  reveal(flow.querySelector('.teammate-reply'),time>=10000);
  reveal(flow.querySelector('.plan-node'),time>=9300);
  reveal(flow.querySelector('.design-node'),time>=10000);
  reveal(flow.querySelector('.flow-composer>div'),time>=800);
  for(const name of ['source','interviews']) reveal(flow.querySelector(`[data-wire="${name}"]`),time>=800);
  reveal(flow.querySelector('[data-wire="branch"]'),time>=9300);
  reveal(flow.querySelector('[data-wire="second"]'),time>=10000);
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
playhead=reducedMotion.matches?10600:0;
renderFlow(playhead);
flowButtons.forEach((button,index)=>button.addEventListener('click',()=>{
  flowStarted=true;flowPlaying=false;playhead=checkpoints[index];
  flow.classList.add('keyboard-change');renderFlow(playhead);syncPlayback();
}));
playButton.addEventListener('click',()=>{
  flowStarted=true;
  if(reducedMotion.matches){playhead=playhead>=10600?0:10600;renderFlow(playhead);return;}
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
  if(event.matches){flowPlaying=false;playhead=10600;renderFlow(playhead);syncPlayback();}
});
updatePlayback();
choices.forEach(button=>button.addEventListener('click',event=>{
  demo.classList.remove('user-play');
  if(event.detail&&!reducedMotion.matches)requestAnimationFrame(()=>demo.classList.add('user-play'));
}));
