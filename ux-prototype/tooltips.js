'use strict';
// Native title popups cannot share our typography, material or timing.
// Preserve iframe titles for accessibility; migrate UI hints as elements arrive.
(()=>{
 const tip=document.createElement('div');tip.id='branch-tooltip';tip.role='tooltip';tip.hidden=true;
 let target=null,timer,lastClosed=0;
 function migrate(root){if(!(root instanceof Element))return;const elements=root.matches('[title]')?[root,...root.querySelectorAll('[title]')]:root.querySelectorAll('[title]');for(const el of elements){if(el.matches('iframe,svg,title'))continue;const text=el.getAttribute('title');if(text&&el.matches('button,a,summary')&&!el.hasAttribute('aria-label')&&!el.textContent.trim())el.setAttribute('aria-label',text);if(text&&!el.matches('.nib,[data-branch-point],#creation-dock button'))el.dataset.tooltip=text;el.removeAttribute('title');if(el===target&&!tip.hidden)tip.textContent=el.dataset.tooltip||'';}}
 function hide(){clearTimeout(timer);if(target){const ids=(target.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==tip.id);if(ids.length)target.setAttribute('aria-describedby',ids.join(' '));else target.removeAttribute('aria-describedby');}if(!tip.hidden)lastClosed=performance.now();tip.hidden=true;target=null;}
 function position(){if(!target?.isConnected)return hide();const r=target.getBoundingClientRect(),t=tip.getBoundingClientRect();let x=Math.max(8,Math.min(innerWidth-t.width-8,r.left+r.width/2-t.width/2));let y=r.top-t.height-9;if(y<8)y=r.bottom+9;tip.style.left=x+'px';tip.style.top=Math.max(8,Math.min(innerHeight-t.height-8,y))+'px';}
 function label(el){return el.dataset.tooltip||((el.matches('.a-icon-button,.a-avatar,.a-share-trigger,.board-home-button'))?el.getAttribute('aria-label'):'');}
 function show(el,keyboard=false){if(el===target)return;hide();const text=label(el);if(!text)return;target=el;timer=setTimeout(()=>{if(target!==el||!el.isConnected)return;const parent=el.closest('dialog[open]')||(document.body.classList.contains('account-mode')?document.getElementById('account-app'):document.body);parent.append(tip);tip.textContent=text;tip.hidden=false;const ids=new Set((el.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));ids.add(tip.id);el.setAttribute('aria-describedby',[...ids].join(' '));position();},keyboard?0:performance.now()-lastClosed<500?80:350);}
 const selector='[data-tooltip],.a-icon-button[aria-label],.a-avatar[aria-label],.a-share-trigger[aria-label],.board-home-button[aria-label]';
 document.addEventListener('pointerover',e=>{if(e.pointerType==='touch'||e.buttons)return;const el=e.target.closest?.(selector);if(el)show(el);else hide();});
 document.addEventListener('pointerout',e=>{if(target&&!target.contains(e.relatedTarget))hide();});
 document.addEventListener('focusin',e=>{const el=e.target.closest?.(selector);if(el&&el.matches(':focus-visible'))show(el,true);});
 document.addEventListener('focusout',hide);document.addEventListener('pointerdown',hide,true);document.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});
 document.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);window.addEventListener('blur',hide);
 migrate(document.body);
 new MutationObserver(records=>{for(const record of records){if(record.type==='attributes'){migrate(record.target);if(record.target===target&&!tip.hidden&&record.attributeName==='data-tooltip'){tip.textContent=label(target);position();}}else for(const node of record.addedNodes)migrate(node);}if(target&&!target.isConnected)hide();}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['title','data-tooltip']});
})();
