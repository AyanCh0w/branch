/* A personal, device-local introduction. Never writes to the shared canvas. */
(()=>{
 const slides=[
  {title:'A little room to think.',text:'I’m the little agent in your dock. Let me show you around your team’s canvas.',scene:'welcome',tags:['Your idea','A shared canvas','New directions']},
  {title:'Start with a little context.',text:'Use the bottom dock to add a note, file, image, or link. Then open a chat and ask your first question.',scene:'context',tags:['A note','A reference','Your question']},
  {title:'One thought. A new direction.',text:'Drag a blue nib from a card into empty space to start a connected chat. Drag it onto an existing chat to bring that context along.',scene:'branch',tags:['Original thought','Explore this','Try that']},
  {title:'Give me something to work on.',text:'Drag an agent from the dock onto the canvas, then give it a task. Its work stays together on the board.',scene:'agent',tags:['A task','Your agent','Work on the canvas']},
  {title:'Find your way around.',text:'Two-finger scroll to pan. Pinch to zoom. Drag a card by its grip to move it, or press F to fit everything on screen.',scene:'move',tags:['Pan','Zoom','Fit · F']},
  {title:'Make space for everyone.',text:'Owners can use Share to invite teammates. Work in separate chats while keeping the context connected. Replay this tour anytime from your account menu.',scene:'team',tags:['Your work','Shared context','Their work']}
 ];
 const dialog=document.createElement('dialog');dialog.id='canvas-tour';dialog.setAttribute('aria-labelledby','canvas-tour-title');dialog.setAttribute('aria-describedby','canvas-tour-copy');
 dialog.innerHTML='<div class="tour-top"><span class="tour-count"></span><button type="button" data-tour="skip">Skip tour</button></div><div class="tour-art" aria-hidden="true"><svg viewBox="0 0 360 96"><path d="M60 48 C105 48 110 20 180 20 S255 48 300 48 M180 20 C180 75 230 76 300 76"/></svg><div class="tour-tile"></div><div class="tour-tile"></div><div class="tour-tile"></div></div><div class="tour-guide" aria-hidden="true"></div><div class="tour-message" aria-live="polite" aria-atomic="true"><h2 id="canvas-tour-title"></h2><p id="canvas-tour-copy"></p></div><div class="tour-controls"><button type="button" data-tour="back">Back</button><div class="tour-dots" aria-hidden="true"></div><button type="button" data-tour="next">Next</button></div>';
 document.body.append(dialog);
 let index=0,returnFocus=null,viewer=false,savedView=null,cameraFrame=null,highlighted=null,samples=null;
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
 function sampleCard(){
  const existing=document.querySelector('#cards .card:has(.nib),#cards .card:has([data-branch-point])');if(existing)return existing;
  if(!samples){
   const world=document.querySelector('#world');if(!world)return null;
   samples=document.createElement('div');samples.className='tour-samples';samples.setAttribute('aria-hidden','true');
   samples.innerHTML='<div class="tour-example" data-tour-example="source"><small>Tour example · not saved</small><strong>A first idea</strong><p>A useful thought for the team.</p><span class="tour-example-nib"></span></div><svg viewBox="0 0 760 250"><path d="M285 90C350 90 365 165 435 165"/></svg><div class="tour-example" data-tour-example="chat"><small>Connected chat</small><strong>Explore a new direction</strong><p>This conversation carries the original context.</p></div>';
   world.append(samples);
  }
  return samples.querySelector('[data-tour-example=source]');
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
  const scene=slides[index].scene;
  let target,card=null;
  if(scene==='branch'){card=sampleCard();target=card?.querySelector('.nib,[data-branch-point],.tour-example-nib');}
  else if(scene==='move'){card=samples||document.querySelector('#cards .card');target=document.querySelector('footer');}
  else target=document.querySelector(scene==='context'?'#creation-dock':scene==='team'?'.a-share-trigger, #board-account-slot .a-avatar':'[data-dock=agent]');
  highlighted=target;target?.classList.add('tour-highlight');
  positionGuide(target,scene==='branch');
  if(card)frameCard(samples||card,scene==='move');else animateView(savedView);
 }
 window.addEventListener('resize',()=>{if(dialog.open)guideStep();});

 function render(){
  const slide=slides[index];dialog.dataset.scene=slide.scene;
  dialog.querySelector('.tour-count').textContent=`${index+1} of ${slides.length}`;
  dialog.querySelector('h2').textContent=slide.title;
  dialog.querySelector('#canvas-tour-copy').textContent=slide.text+(viewer&&index===0?' This canvas is view-only for you; editing tools become available with edit access.':'');
  dialog.querySelectorAll('.tour-tile').forEach((tile,i)=>tile.textContent=slide.tags[i]);
  dialog.querySelector('.tour-dots').innerHTML=slides.map((_,i)=>`<i${i===index?' class="current"':''}></i>`).join('');
  dialog.querySelector('[data-tour="back"]').disabled=index===0;
  dialog.querySelector('[data-tour="next"]').textContent=index===slides.length-1?'Let’s build':'Next';
  guideStep();
 }
 function finish(){
  if(!dialog.open)return;
  if(cameraFrame!==null)cancelAnimationFrame(cameraFrame);cameraFrame=null;
  clearHighlight();samples?.remove();samples=null;if(savedView)window.BranchHost?.setView?.(savedView);savedView=null;
  dialog.close();document.body.classList.remove('canvas-tour-open');
  const target=returnFocus?.isConnected?returnFocus:document.querySelector('[data-dock=agent]');target?.focus({preventScroll:true});
 }
 function start({userId,force=false,role}={}){
  if(!userId||document.body.classList.contains('account-mode'))return false;
  // Replay on every canvas entry while the introduction is being refined.
  if(dialog.open)return false;
  savedView=window.BranchHost?.captureView?.()||null;index=0;viewer=role==='viewer'||!!document.querySelector('.a-viewer-label');returnFocus=document.activeElement;
  const guide=dialog.querySelector('.tour-guide'),avatar=document.querySelector('.dock-agent-avatar img');guide.replaceChildren();
  if(avatar){const image=avatar.cloneNode(true);image.alt='';guide.append(image);}
  else {const url=window.BranchAvatar?.('Canvas guide','#6685cf',true);if(url){const image=document.createElement('img');image.src=url;image.alt='';guide.append(image);}}
  render();document.body.classList.add('canvas-tour-open');dialog.showModal();guideStep();dialog.querySelector('[data-tour="next"]').focus();return true;
 }
 dialog.addEventListener('click',e=>{const action=e.target.closest('[data-tour]')?.dataset.tour;if(action==='skip')finish();if(action==='back'&&index>0){index--;render();}if(action==='next'){if(index===slides.length-1)finish();else{index++;render();}}});
 dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});
 // Keep canvas shortcuts from creating or moving cards while reading the tour.
 dialog.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='ArrowRight'){e.preventDefault();dialog.querySelector('[data-tour="next"]').click();}if(e.key==='ArrowLeft'){e.preventDefault();dialog.querySelector('[data-tour="back"]').click();}});
 window.BranchCanvasTour={start,dismiss:()=>finish()};
})();
