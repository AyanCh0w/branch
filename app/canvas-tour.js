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
 let index=0,key=null,returnFocus=null,viewer=false;
 const seen=new Set();
 function render(){
  const slide=slides[index];dialog.dataset.scene=slide.scene;
  dialog.querySelector('.tour-count').textContent=`${index+1} of ${slides.length}`;
  dialog.querySelector('h2').textContent=slide.title;
  dialog.querySelector('#canvas-tour-copy').textContent=slide.text+(viewer&&index===0?' This canvas is view-only for you; editing tools become available with edit access.':'');
  dialog.querySelectorAll('.tour-tile').forEach((tile,i)=>tile.textContent=slide.tags[i]);
  dialog.querySelector('.tour-dots').innerHTML=slides.map((_,i)=>`<i${i===index?' class="current"':''}></i>`).join('');
  dialog.querySelector('[data-tour="back"]').disabled=index===0;
  dialog.querySelector('[data-tour="next"]').textContent=index===slides.length-1?'Let’s build':'Next';
 }
 function finish(remember=true){
  if(!dialog.open)return;
  if(remember&&key){seen.add(key);try{localStorage.setItem(key,'seen');}catch{}}
  dialog.close();document.body.classList.remove('canvas-tour-open');
  const target=returnFocus?.isConnected?returnFocus:document.querySelector('[data-dock=agent]');target?.focus({preventScroll:true});
 }
 function start({userId,force=false,role}={}){
  if(!userId||document.body.classList.contains('account-mode'))return false;
  const nextKey='branch-canvas-tour-v1:'+userId;
  let completed=seen.has(nextKey);try{completed=completed||localStorage.getItem(nextKey)==='seen';}catch{}
  if(dialog.open||(!force&&completed))return false;
  key=nextKey;index=0;viewer=role==='viewer'||!!document.querySelector('.a-viewer-label');returnFocus=document.activeElement;
  const guide=dialog.querySelector('.tour-guide'),avatar=document.querySelector('.dock-agent-avatar img');guide.replaceChildren();
  if(avatar){const image=avatar.cloneNode(true);image.alt='';guide.append(image);}
  else {const url=window.BranchAvatar?.('Canvas guide','#6685cf',true);if(url){const image=document.createElement('img');image.src=url;image.alt='';guide.append(image);}}
  render();document.body.classList.add('canvas-tour-open');dialog.showModal();dialog.querySelector('[data-tour="next"]').focus();return true;
 }
 dialog.addEventListener('click',e=>{const action=e.target.closest('[data-tour]')?.dataset.tour;if(action==='skip')finish();if(action==='back'&&index>0){index--;render();}if(action==='next'){if(index===slides.length-1)finish();else{index++;render();}}});
 dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});
 // Keep canvas shortcuts from creating or moving cards while reading the tour.
 dialog.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='ArrowRight'){e.preventDefault();dialog.querySelector('[data-tour="next"]').click();}if(e.key==='ArrowLeft'){e.preventDefault();dialog.querySelector('[data-tour="back"]').click();}});
 window.BranchCanvasTour={start,dismiss:()=>finish(false)};
})();
