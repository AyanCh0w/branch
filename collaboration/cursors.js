// Ephemeral human presence. Never writes canvas content or editing leases.
export function startCursors({client,scope,tabId,host}){
 const board=document.getElementById('board');
 if(!board||!host.boardPoint||!host.screenPoint)return ()=>{};
 const layer=document.createElement('div');layer.className='human-cursors';layer.setAttribute('aria-hidden','true');board.append(layer);
 let disposed=false,online=client.connectionState().isWebSocketConnected,rows=[],pointer=null,pending,writing=false,timer,lastSent=0;
 const elements=new Map();
 function render(){
  const visible=new Set();
  if(online&&!document.hidden)for(const row of rows){
   if(row.expiresAt<=Date.now())continue;
   const key=row.userId+':'+row.tabId;visible.add(key);
   let el=elements.get(key);
   if(!el){el=document.createElement('div');el.className='human-cursor';el.innerHTML='<svg viewBox="0 0 24 28" width="20" height="24"><path d="M3 2L20 16L12 17L8 25Z" fill="currentColor" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg><span></span>';layer.append(el);elements.set(key,el);}
   el.querySelector('span').textContent=row.name;
   el.style.color=/^#[0-9a-f]{6}$/i.test(row.color)?row.color:'#6685cf';
   const point=host.screenPoint(row.x,row.y);el.style.transform=`translate3d(${point.x}px,${point.y}px,0)`;
  }
  for(const [key,el]of elements)if(!visible.has(key)){el.remove();elements.delete(key);}
 }
 async function flush(){
  clearTimeout(timer);timer=null;
  if(writing||pending===undefined||!online)return;
  const position=pending;pending=undefined;writing=true;lastSent=Date.now();
  try{await client.mutation('collaboration:point',{...scope,tabId,position});}catch{/* Presence failure must not disable editing. */}
  finally{writing=false;if(disposed){if(position)client.mutation('collaboration:point',{...scope,tabId,position:null}).catch(()=>{});}else if(pending!==undefined)schedule();}
 }
 function schedule(){if(!timer&&!writing)timer=setTimeout(flush,Math.max(0,80-(Date.now()-lastSent)));}
 function publish(){pending=pointer&&!document.hidden?host.boardPoint(pointer.x,pointer.y):null;schedule();}
 function move(e){
  if(!e.target.closest?.('#board')||e.target.closest('iframe'))return leave();
  pointer={x:e.clientX,y:e.clientY};publish();
 }
 function leave(){pointer=null;publish();}
 function up(e){if(e.pointerType==='touch')leave();}
 function camera(){render();if(pointer)publish();}
 function visibility(){if(document.hidden)leave();render();}
 const offRows=client.onUpdate('collaboration:cursors',scope,value=>{rows=value;render();},()=>{rows=[];render();});
 const offConnection=client.subscribeToConnectionState(value=>{online=value.isWebSocketConnected;render();if(online)publish();});
 document.addEventListener('pointermove',move);document.addEventListener('pointerdown',move);
 document.addEventListener('pointerup',up);document.addEventListener('pointercancel',leave);
 document.addEventListener('visibilitychange',visibility);document.addEventListener('branch-camera',camera);
 document.documentElement.addEventListener('pointerleave',leave);window.addEventListener('blur',leave);window.addEventListener('pagehide',leave);
 const heartbeat=setInterval(()=>{render();if(pointer&&online)publish();},5000);
 const expiry=setInterval(render,1000);
 return ()=>{
  disposed=true;clearTimeout(timer);clearInterval(heartbeat);clearInterval(expiry);pending=undefined;
  offRows();offConnection();layer.remove();
  document.removeEventListener('pointermove',move);document.removeEventListener('pointerdown',move);
  document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',leave);
  document.removeEventListener('visibilitychange',visibility);document.removeEventListener('branch-camera',camera);
  document.documentElement.removeEventListener('pointerleave',leave);window.removeEventListener('blur',leave);window.removeEventListener('pagehide',leave);
  if(!writing)client.mutation('collaboration:point',{...scope,tabId,position:null}).catch(()=>{});
 };
}
