/* A personal, device-local introduction. Never writes to the shared canvas. */
(()=>{
 const slides=[
  {title:'Start with one shared node.',text:'Put your goal, constraints, and decisions in a team brief. It gives everyone a starting point they can see and build on.',scene:'brief'},
  {title:'See the whole team at once.',text:'Everyone’s threads live on the same canvas. See what each person is working on and where the team is heading, without asking for an update.',scene:'overview'},
  {title:'Share the context.',text:'Connect the brief, notes, or files to a chat with a blue nib. Everyone can work from the same background while exploring different questions.',scene:'context'},
  {title:'Make the plan together.',text:'Keep responsibilities, decisions, and next steps in a shared note beside the conversations. Your team can update the plan as the work changes.',scene:'plan'},
  {title:'Explore in parallel.',text:'Drag a blue nib into empty space to branch a conversation. Carry its context into a new direction while the original thread stays where the team can see it.',scene:'branch'},
  {title:'Bring your team in.',text:'Owners can invite teammates with Share. Two-finger scroll to pan, pinch to zoom, and press F to see the whole canvas.',scene:'team'},
  {title:'Connect an agent.',text:'Choose how to bring work from another chat into this board’s Context view.',scene:'connections'}
 ];
 const dialog=document.createElement('dialog');dialog.id='canvas-tour';dialog.setAttribute('aria-labelledby','canvas-tour-title');dialog.setAttribute('aria-describedby','canvas-tour-copy');
 dialog.innerHTML=`
  <div class="tour-top"><span class="tour-count"></span><div class="tour-shortcuts">
   <button type="button" data-tour="connections">Connect an agent</button><button type="button" data-tour="skip">Skip tour</button>
  </div></div>
  <div class="tour-guide" aria-hidden="true"></div>
  <div class="tour-message">
   <div aria-live="polite" aria-atomic="true"><h2 id="canvas-tour-title"></h2><p id="canvas-tour-copy"></p></div>
   <section class="tour-connections" aria-label="Agent setup" hidden>
    <div class="tour-providers" role="group" aria-label="Choose an agent">
     <button type="button" data-tour="provider" data-provider="chatgpt" aria-pressed="true">ChatGPT or Codex</button>
     <button type="button" data-tour="provider" data-provider="claude" aria-pressed="false">Claude Code</button>
    </div>
    <div class="tour-provider-panel" data-tour-panel="chatgpt">
     <p>Bring new replies from a ChatGPT or Codex conversation into this board’s Context.</p>
     <button type="button" class="tour-action tour-open-mac" data-tour="connect-mac">Connect a conversation</button>
     <p>Choose your chat in Branch for Mac. Send a message once it says Sync is on.</p>
     <button type="button" data-tour="copy-setup">Copy setup instructions</button>
     <a class="tour-setup-link" href="/mac-setup.html" target="_blank" rel="noopener noreferrer">Installation guide ↗</a>
     <p class="tour-setup-note">If Branch for Mac didn’t open, use the installation guide.</p>
     <textarea readonly rows="5" aria-label="Mac sync setup instructions" data-setup-fallback hidden></textarea>
     <details class="tour-troubleshooting"><summary>Troubleshooting an installed app</summary><p>Only use this check after installation, if the app asks you to verify what it can read.</p>
      <textarea readonly rows="3" aria-label="Baseline prompt" data-baseline></textarea>
      <button type="button" data-tour="copy-baseline">Copy compatibility prompt</button>
      <button type="button" data-tour="chrome" hidden>Chrome sync settings</button>
     </details>
    </div>
    <div class="tour-provider-panel" data-tour-panel="claude" hidden>
     <p>Connect Claude Code to send card context and return drafts for review.</p>
     <button type="button" class="tour-action" data-tour="claude">Set up Claude Code</button>
    </div>
    <p class="tour-connection-status" role="status"></p>
   </section>
  </div>
  <div class="tour-controls"><button type="button" data-tour="back">Back</button><div class="tour-dots" aria-hidden="true"></div><button type="button" data-tour="next">Next</button></div>`;
 document.body.append(dialog);
 let index=0,returnFocus=null,viewer=false,savedView=null,cameraFrame=null,highlighted=null,samples=null;
 const seenUsers=new Set();
 const seenKey=userId=>`branch:canvas-tour:seen:${userId}`;
 function hasSeen(userId){
  if(seenUsers.has(userId))return true;
  try{return localStorage.getItem(seenKey(userId))==='1';}catch{return false;}
 }
 function markSeen(userId){
  seenUsers.add(userId);
  try{localStorage.setItem(seenKey(userId),'1');}catch{}
 }
 let provider='chatgpt', baselinePrompt='';
 const connections=dialog.querySelector('.tour-connections');
 const promptField=dialog.querySelector('[data-baseline]');
 const connectionStatus=dialog.querySelector('.tour-connection-status');
 const chromeControl=()=>document.querySelector('[data-open-chrome-sync]');
 const motion=window.matchMedia?.("(prefers-reduced-motion: reduce)");
 function clearHighlight(){highlighted?.classList.remove('tour-highlight');highlighted=null;}
 function animateView(target){
  if(cameraFrame!==null)cancelAnimationFrame(cameraFrame);cameraFrame=null;
  const host=window.BranchHost,from=host?.captureView?.();if(!from||!target)return;
  if(motion?.matches){host.setView(target);return;}
  const started=performance.now();
  function frame(now){const t=Math.min(1,(now-started)/520),ease=1-Math.pow(1-t,3);host.setView({x:from.x+(target.x-from.x)*ease,y:from.y+(target.y-from.y)*ease,z:from.z+(target.z-from.z)*ease});if(t<1&&dialog.open)cameraFrame=requestAnimationFrame(frame);else cameraFrame=null;}
  cameraFrame=requestAnimationFrame(frame);
 }
 function ensureExamples(){
  if(samples)return samples;
  const world=document.querySelector('#world');if(!world)return null;
  samples=document.createElement('div');samples.className='tour-samples';samples.setAttribute('aria-hidden','true');
  // Put tutorial artwork beyond existing cards. No records, messages or board edits are created.
  const nodes=window.BranchHost?.getState?.()?.nodes||[];
  if(nodes.length)samples.style.left=Math.max(...nodes.map(n=>(Number(n.x)||0)+(Number(n.width)||520)))+180+'px';
  samples.innerHTML=`
   <div class="tour-overview-frame"></div><div class="tour-branch-frame"></div>
   <div class="tour-example" data-tour-example="brief"><small>Tour example · not saved</small><strong>Team brief</strong><p>Build a campus study app.</p><ul><li>Find a group for any class</li><li>Keep the first version simple</li><li>Demo together on Friday</li></ul><span class="tour-example-nib"></span></div>
   <svg class="tour-context-wires" viewBox="0 0 1110 650"><path d="M314 210C355 210 355 90 396 90 M314 210C355 210 355 310 396 310 M314 210C355 210 355 530 396 530"/></svg>
   <div class="tour-example tour-thread" data-tour-example="design"><small><i class="tour-person coral">M</i>Maya · Design</small><strong>Explore the interface</strong><p class="tour-prompt">How should students find a group?</p><p>Comparing a class list with a search-first flow.</p><span class="tour-example-input"></span><span class="tour-example-nib"></span></div>
   <div class="tour-example tour-thread" data-tour-example="data"><small><i class="tour-person blue">L</i>Leo · Data</small><strong>Work out the data model</strong><p class="tour-prompt">What should a study group store?</p><p>Defining classes, members, and meeting times.</p><span class="tour-example-input"></span></div>
   <div class="tour-example tour-thread" data-tour-example="you"><small><i class="tour-person green">Y</i>You · Research</small><strong>Understand the students</strong><p class="tour-prompt">What makes joining a group hard?</p><p>Collecting questions for student interviews.</p><span class="tour-example-input"></span></div>
   <div class="tour-example" data-tour-example="plan"><small>Shared note · everyone can edit</small><strong>Our next steps</strong><ul><li>Maya → sketch the first screen</li><li>Leo → define the group model</li><li>You → interview three students</li></ul><p>Decide together after the first round.</p></div>
   <svg class="tour-branch-wire" viewBox="0 0 1110 650"><path d="M724 90C755 90 755 210 786 210"/></svg>
   <div class="tour-example" data-tour-example="branch"><small><i class="tour-person coral">M</i>Maya · A new direction</small><strong>Try a search-first flow</strong><p class="tour-prompt">Explore this option in more detail.</p><p>Same brief. A separate conversation.</p><span class="tour-example-input"></span></div>`;
  world.append(samples);return samples;
 }
 function frameCard(card,overview=false){
  const host=window.BranchHost,current=host?.captureView?.();if(!card||!current)return;
  const r=card.getBoundingClientRect(),board=document.querySelector('#board')?.getBoundingClientRect();if(!r.width||!r.height)return;
  const compact=innerWidth<700,panelHeight=dialog.offsetHeight;
  const area=compact?{left:24,top:80,width:innerWidth-48,height:Math.max(100,innerHeight-panelHeight-210)}:{left:50,top:100,width:Math.max(180,innerWidth-dialog.offsetWidth-150),height:innerHeight-230};
  const fit=Math.min(area.width/r.width,area.height/r.height),z=Math.max(.1,Math.min(overview ? .72 : 1.18,current.z*fit));
  const worldX=(r.left+r.width/2-current.x)/current.z,worldY=(r.top+r.height/2-(board?.top||0)-current.y)/current.z;
  animateView({x:area.left+area.width/2-worldX*z,y:area.top+area.height/2-(board?.top||0)-worldY*z,z});
 }
 function positionGuide(target,cardScene=false){
  const compact=innerWidth<700,w=dialog.offsetWidth||350,h=dialog.offsetHeight||320,pad=16;
  let left,top;
  if(compact){left=(innerWidth-w)/2;top=innerHeight-h-90;}
  else if(cardScene){left=innerWidth-w-28;top=(innerHeight-h)/2;}
  else if(target){const r=target.getBoundingClientRect();left=r.left+r.width/2-w/2;top=r.top>innerHeight/2?r.top-h-22:r.bottom+22;}
  else{left=innerWidth-w-28;top=innerHeight-h-100;}
  dialog.style.left=Math.max(pad,Math.min(innerWidth-w-pad,left))+'px';dialog.style.top=Math.max(pad,Math.min(innerHeight-h-pad,top))+'px';
 }
 function guideStep(){
  if(!dialog.open)return;clearHighlight();
  const scene=slides[index].scene,examples=ensureExamples();
  if(examples)examples.dataset.scene=scene;
  let target=null,frame=null;
  if(scene==='connections'){
   if(document.body.classList.contains('board-context-mode')){positionGuide(null);return;}
   target=document.querySelector('#context-tab');
  }else if(scene==='team'){
   target=[...document.querySelectorAll('.a-share-trigger')].find(el=>el.textContent.trim()==='Share')||document.querySelector('#board-account-slot .a-avatar');
  }else if(examples){
   const node=kind=>examples.querySelector(`[data-tour-example="${kind}"]`);
   if(scene==='brief'){target=node('brief');frame=target;}
   if(scene==='overview'){frame=examples.querySelector('.tour-overview-frame');}
   if(scene==='context'){target=node('brief').querySelector('.tour-example-nib');frame=examples.querySelector('.tour-overview-frame');}
   if(scene==='plan'){target=node('plan');frame=target;}
   if(scene==='branch'){target=node('design').querySelector('.tour-example-nib');frame=examples.querySelector('.tour-branch-frame');}
  }
  highlighted=target;target?.classList.add('tour-highlight');
  positionGuide(target,scene!=='team'&&scene!=='connections');
  if(frame)frameCard(frame,scene==='overview');else animateView(savedView);
 }
 window.addEventListener('resize',()=>{if(dialog.open)guideStep();});

 function render(){
  const slide=slides[index];dialog.dataset.scene=slide.scene;
  dialog.querySelector('.tour-count').textContent=`${index+1} of ${slides.length}`;
  dialog.querySelector('h2').textContent=slide.title;
  dialog.querySelector('#canvas-tour-copy').textContent=slide.text+(viewer&&index===0?' This canvas is view-only for you; editing tools become available with edit access.':'');
  dialog.querySelector('.tour-dots').innerHTML=slides.map((_,i)=>`<i${i===index?' class="current"':''}></i>`).join('');
  dialog.querySelector('[data-tour="back"]').disabled=index===0;
  dialog.querySelector('[data-tour="next"]').textContent=index===slides.length-1?'Let’s build':'Next';
  dialog.querySelector('[data-tour="connections"]').hidden=slide.scene==='connections';
  connections.hidden=slide.scene!=='connections';
  if(!connections.hidden)renderConnections();
  guideStep();
 }
 function renderConnections(){
  for(const button of connections.querySelectorAll('[data-provider]')){
   button.setAttribute('aria-pressed',String(button.dataset.provider===provider));
  }
  for(const panel of connections.querySelectorAll('[data-tour-panel]'))panel.hidden=panel.dataset.tourPanel!==provider;
  const boardId=new URLSearchParams(location.search).get('board');
  dialog.querySelector('.tour-open-mac').hidden=viewer||!boardId||location.protocol!=='https:';
  dialog.querySelector('.tour-setup-link').href='/mac-setup.html'+(/^[A-Za-z0-9_-]{1,160}$/.test(boardId||'')?'?board='+encodeURIComponent(boardId):'');
  promptField.value=baselinePrompt;
  dialog.querySelector('[data-tour="copy-baseline"]').disabled=!baselinePrompt;
  dialog.querySelector('[data-tour="chrome"]').hidden=viewer||!chromeControl();
  dialog.querySelector('[data-tour="claude"]').hidden=viewer;
  dialog.querySelector('[data-tour="copy-setup"]').hidden=viewer;
  connectionStatus.textContent=viewer&&provider==='claude'?'Ask a board editor to connect Claude Code.':'';
 }
 async function copySetup(){
  const value=window.BranchMacSetup.handoff(new URLSearchParams(location.search).get('board'));
  const field=dialog.querySelector('[data-setup-fallback]');
  try{await navigator.clipboard.writeText(value);field.hidden=true;connectionStatus.textContent='Setup instructions copied. Paste them into the conversation you want to connect.';}
  catch{field.value=value;field.hidden=false;field.focus();field.select();connectionStatus.textContent='Copy the selected instructions and paste them into the conversation you want to connect.';}
 }
 async function copyBaseline(){
  try{
   await navigator.clipboard.writeText(baselinePrompt);
   if(dialog.open&&!connections.hidden&&provider==='chatgpt')connectionStatus.textContent='Baseline prompt copied.';
  }catch{
   if(!dialog.open||connections.hidden||provider!=='chatgpt')return;
   promptField.focus();promptField.select();
   connectionStatus.textContent='Press Copy to copy the selected prompt.';
  }
 }
 function showConnections(){
  index=slides.length-1;render();
  connections.querySelector('[aria-pressed="true"]').focus();
 }
 function finish(){
  if(!dialog.open)return;
  if(cameraFrame!==null)cancelAnimationFrame(cameraFrame);cameraFrame=null;
  clearHighlight();samples?.remove();samples=null;if(savedView)window.BranchHost?.setView?.(savedView);savedView=null;
  dialog.close();document.body.classList.remove('canvas-tour-open');
  const target=returnFocus?.isConnected?returnFocus:document.querySelector('[data-dock=agent]');target?.focus({preventScroll:true});
 }
 function start({userId,force=false,role,scene}={}){
  if(!userId||document.body.classList.contains('account-mode'))return false;
  if(!force&&new URLSearchParams(location.search).has('context'))return false;
  // Show automatically once per person on this browser. Account can reopen it.
  if(dialog.open||(!force&&hasSeen(userId)))return false;
  savedView=window.BranchHost?.captureView?.()||null;index=scene==='connections'?slides.length-1:0;provider='chatgpt';viewer=role==='viewer'||!!document.querySelector('.a-viewer-label');returnFocus=document.activeElement;
  const guide=dialog.querySelector('.tour-guide'),avatar=document.querySelector('.dock-agent-avatar img');guide.replaceChildren();
  if(avatar){const image=avatar.cloneNode(true);image.alt='';guide.append(image);}
  else {const url=window.BranchAvatar?.('Canvas guide','#6685cf',true);if(url){const image=document.createElement('img');image.src=url;image.alt='';guide.append(image);}}
  render();document.body.classList.add('canvas-tour-open');dialog.showModal();markSeen(userId);guideStep();
  (scene==='connections'?connections.querySelector('[aria-pressed="true"]'):dialog.querySelector('[data-tour="next"]')).focus();
  return true;
 }
 dialog.addEventListener('click',e=>{
  const button=e.target.closest('[data-tour]');
  switch(button?.dataset.tour){
   case 'skip':finish();break;
   case 'back':if(index>0){index--;render();}break;
   case 'next':if(index===slides.length-1)finish();else{index++;render();}break;
   case 'connections':showConnections();break;
   case 'provider':provider=button.dataset.provider;renderConnections();guideStep();break;
   case 'connect-mac': {
    if (viewer) break;
    button.disabled=true;
    connectionStatus.textContent='Opening Branch for Mac…';
    window.dispatchEvent(new CustomEvent('branch:connect-mac',{detail:{respond:async launch=>{
     try{await launch;connectionStatus.textContent='Continue in Branch for Mac.';}
     catch{connectionStatus.textContent='Could not open Branch for Mac. Try again.';}
     finally{button.disabled=false;}
    }}}));
    break;
   }
   case 'copy-setup':void copySetup();break;
   case 'copy-baseline':void copyBaseline();break;
   case 'chrome':{
    const setup=chromeControl();
    if(!viewer&&setup){finish();setup.click();}
    break;
   }
   case 'claude':
    if(viewer)break;
    if(window.BranchCoding?.canConnect()){finish();window.BranchCoding.openConnection();}
    else connectionStatus.textContent='Wait for the board to finish loading, then try again.';
    break;
  }
 });
 dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});
 // Keep canvas shortcuts from creating or moving cards while reading the tour.
 dialog.addEventListener('keydown',e=>{e.stopPropagation();if(e.target.tagName==='TEXTAREA')return;if(e.key==='ArrowRight'){e.preventDefault();dialog.querySelector('[data-tour="next"]').click();}if(e.key==='ArrowLeft'){e.preventDefault();dialog.querySelector('[data-tour="back"]').click();}});
 window.BranchCanvasTour={start,dismiss:()=>finish(),setBaselinePrompt:prompt=>{baselinePrompt=prompt;}};
})();
