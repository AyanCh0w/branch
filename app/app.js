'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>window.Iconoir[name]||'';
const id=()=>crypto.randomUUID(), clone=x=>JSON.parse(JSON.stringify(x)), KEY='branch-workspace-v2';
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const reactiveGrid=window.createReactiveGrid($('#board'));
function initialState(){
 const plan={id:'plan',type:'plan',title:'Planning the workspace',body:'A shared canvas for people and AI.\n\nLet users invite teammates with a link.\n\nNew conversations should keep their source context. Make it clear who contributed what, and let the useful parts flow back into the plan.',x:100,y:125,revision:1,author:'You'};
 return {title:'Product workspace',nodes:[plan,{id:'thread',type:'thread',title:'Inviting teammates',x:650,y:205,revision:1,contexts:[{id:'initial-context',source:'plan',title:plan.title,body:plan.body,revision:1,quote:'Let users invite teammates with a link.',enabled:true}],messages:[],draft:''}],events:[],tests:[],notes:''};
}
let state;try{state=JSON.parse(localStorage.getItem(KEY));if(!state||!Array.isArray(state.nodes))state=initialState()}catch{state=initialState()}
for(const n of state.nodes)if(n.titleEdited===undefined&&n.titleGenerated===undefined)n.titleEdited=true;
let assetURLs=new Map(),cardObserver=null;
const loadingFiles=new Set(),fileErrors=new Map();
const videoRequests=new Map(),videoResults=new Map(),videoErrors=new Map();
let playingVideos=new Set(),generatingChats=new Map();
const titleTimers=new Map(),titleRequests=new Map();
const expandedAgentSources=new Set(),collapsedAgentWorkspaces=new Set();
const inspectedSources=new Set(),openWebsitePerspectives=new Set();
const expandingIdeas=new Map(),ideaPreviews=new Map(),expandedChats=new Set(),expandedNotes=new Set();
let panelNodeId=null,panelContentObserver=null;
function compactChat(n){return n.type==='thread'&&!n.agent&&panelNodeId!==n.id&&!expandedChats.has(n.id);}
function onCardEvent(type,handler){document.addEventListener(type,e=>{if(e.target.closest?.('.card'))handler(e);});}
let mediaRequests=new Map(),mediaBusy=new Set(),mediaErrors=new Map(),suppressMediaClickUntil=0;
let undoHistory=[],future=[],focused=null,selection=null,gesture=null,menuPoint=null;
let lastHeldNode=null;
function raiseHeldNode(nodeId){lastHeldNode=nodeId; $$('.card.last-held').forEach(el=>el.classList.remove('last-held'));cardEl(nodeId)?.classList.add('last-held');}
let camera={x:0,y:0,z:1},editing=null,openContexts=new Set(),frame=0,lastFrame=0,wire=null,cardSprings=new Map();
const nodeById=id=>state.nodes.find(n=>n.id===id);
const cardEl=id=>document.querySelector(`[data-node="${id}"]`);
function save(){window.BoardShared?.saveState(state);try{localStorage.setItem(KEY,JSON.stringify(state));$('#save-state').textContent='Saved on this device'}catch{$('#save-state').textContent='Storage full — export session'}}
function record(action){state.events.push({action,at:new Date().toISOString()});save()}
function remember(){commitEdit();undoHistory.push(clone(state));if(undoHistory.length>70)undoHistory.shift();future=[];$('#undo').disabled=false}
function notify(text){$('#notice').textContent=text;$('#notice').classList.add('visible');clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('#notice').classList.remove('visible'),2800)}
function undo(redo=false){if(window.BoardShared?.enabled)return window.BoardShared.undo(redo);titleTimers.forEach(clearTimeout);titleTimers.clear();titleRequests.forEach(c=>c.abort());titleRequests.clear();generatingChats.forEach(c=>c.abort());generatingChats.clear();cancelGesture();stopAllSprings();commitEdit();const from=redo?future:undoHistory,to=redo?undoHistory:future;if(!from.length)return;to.push(clone(state));state=from.pop();openContexts.clear();render();save();notify(redo?'Restored':'Undone')}
function rememberEditing(e){const el=e.target;if(!el.matches('[data-edit]'))return;const n=nodeById(el.closest('.card')?.dataset.node);editing={node:n?.id,field:el.dataset.edit,before:clone(state),value:n?.[el.dataset.edit]??state.title}}
function commitEdit(){if(!editing)return;const e=editing;editing=null;const n=nodeById(e.node),current=n?n[e.field]:state.title;if(current!==e.value){undoHistory.push(e.before);future=[];if(n&&(e.field==='body'||e.field==='title')){n.revision=(n.revision||1)+1;n.author='You';const label=cardEl(n.id)?.querySelector('.node-status');if(label)label.textContent='v'+n.revision;syncContextIndicators(n.id);syncDraftContext(n);scheduleNodeTitle(n)}save();$('#undo').disabled=false;requestDraw()}}
function nibMarkup(n){if(!BranchContext.hasContent(n))return '';return `<button class="nib" data-port="${n.id}" aria-label="Drag context from ${escapeHTML(n.title)}" ><span class="nib-label">Create branch</span></button>`}
function contextMarkup(c){const source=nodeById(c.source),stale=source&&(source.revision!==c.revision||(!c.attachment&&!c.quote&&((source.type==='upload'&&!source.text)||(source.type==='media'&&source.mediaType!=='video'))));const symbol=source?.type==='media'?(source.mediaType==='video'?'youtube':'media-image'):source?.type==='upload'?'attachment':source?.type==='thread'?'chat-bubble':'page';return `<span class="context-reference"><button type="button" class="context-chip ${stale?'stale':''}" data-context="${c.id}" aria-haspopup="dialog" aria-label="Inspect context: ${escapeHTML(c.title)}" title="${escapeHTML(c.title)}${stale?' · source updated':''}">${icon(symbol)}<span class="chip-title">${escapeHTML(c.title)}</span>${stale?'<i class="source-updated"></i>':''}</button></span>`}

function contextPreviewMarkup(c){if(c.enabled===false)return '';const a=c.attachment;const url=a?.url||assetURLs.get(a?.asset);if(a?.kind==='image'&&url)return `<img class="context-image-preview" src="${escapeHTML(url)}" alt="${escapeHTML(c.title)}">`;if(a?.kind==='pdf'&&url)return `<branch-pdf src="${escapeHTML(url)}" data-key="context-${escapeHTML(c.id)}"></branch-pdf>`;return c.availability?`<p class="context-availability">${escapeHTML(c.availability)}</p>`:a?`<p class="context-availability">${a.storageId?'File attached for chat':'File not available to chat yet. Enable chat context on its source card, then refresh this reference.'}</p>`:'';}
function contextDetails(n){return (n.contexts||[]).filter(c=>openContexts.has(c.id)).map(c=>{const source=nodeById(c.source),stale=source&&(source.revision!==c.revision||(!c.attachment&&!c.quote&&((source.type==='upload'&&!source.text)||(source.type==='media'&&source.mediaType!=='video'))));const upstream=BranchContext.resolveContext(c.inherited||[]);return `<section class="context-detail flat-context"><div class="context-tools"><span>${c.excerptOnly?'Selected text · ':''}${escapeHTML(c.title)}</span><span class="context-version">v${c.revision}</span><label class="icon-toggle" title="Include full source snapshot"><input type="checkbox" data-toggle-context="${c.id}" ${c.enabled?'checked':''}><span>${icon('check')}</span><span class="sr-only">Include full source snapshot</span></label>${stale?`<button type="button" data-refresh-context="${c.id}" title="Refresh source snapshot" aria-label="Refresh source snapshot">${icon('refresh')}</button>`:''}<button type="button" data-detach-context="${c.id}" title="Detach context" aria-label="Detach context">${icon('xmark')}</button></div>${contextPreviewMarkup(c)}<p class="context-excerpt">${escapeHTML(c.enabled?c.body:c.quote||'')}</p>${upstream.length?`<div class="upstream-flat">${upstream.map(u=>`<span title="${escapeHTML(u.quote||u.text)}">${escapeHTML(u.title)}</span>`).join('')}</div>`:''}</section>`}).join('')}
function personMarkup(person){return person&&window.BranchAvatar?`<span class="person-byline"><img src="${escapeHTML(window.BranchAvatar(person.name,person.color))}" alt=""/>${escapeHTML(person.name)}</span>`:''}
// GitHub cards hold server-fetched content; Refresh re-fetches it from GitHub.
function githubMarkup(n){const g=n.github||{};const label=g.kind==='file'?'File':g.kind==='pull'?'Pull request':'Issue';const url=/^https:\/\/github\.com\//.test(g.url||'')?g.url:'';
 const meta=g.kind==='file'?[g.ref,g.sha&&String(g.sha).slice(0,7)].filter(Boolean).map(escapeHTML).join(' · '):g.kind==='pull'?`@${escapeHTML(g.author||'')} · ${escapeHTML(g.head||'')} → ${escapeHTML(g.base||'')} · <span class="gh-add">+${Number(g.additions)||0}</span> <span class="gh-del">−${Number(g.deletions)||0}</span>`:`@${escapeHTML(g.author||'')}${g.comments?' · '+Number(g.comments)+' comment'+(g.comments===1?'':'s'):''}${(g.labels||[]).map(l=>` <span class="gh-label">${escapeHTML(l)}</span>`).join('')}`;
 const lines=String(n.text||'').split('\n');
 const body=g.kind==='file'?`<pre class="gh-code"><code>${escapeHTML(lines.slice(0,400).join('\n'))}</code></pre>${lines.length>400?`<p class="gh-note">${lines.length-400} more lines are included as context.</p>`:''}`:`<div class="gh-body">${messageHTML(n.text||'')}</div>`;
 const writable=!window.BoardShared?.enabled||window.BoardShared.writable;
 return `<div class="card-main github-content"><div class="gh-head">${icon('github')}<span class="gh-repo">${escapeHTML(g.repo||'')}</span><span class="gh-kind">${label}</span>${g.kind==='file'?'':`<span class="gh-state" data-state="${escapeHTML(g.state||'open')}">${escapeHTML(g.state||'open')}</span>`}</div><div class="gh-meta">${meta}</div>${body}${g.truncated?'<p class="gh-note">Long content was truncated to fit a card.</p>':''}</div><div class="card-footer gh-footer"><span class="gh-fetched">${g.fetchedAt?'Fetched '+escapeHTML(new Date(g.fetchedAt).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})):''}</span><span class="gh-actions">${url?`<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">GitHub ${icon('arrow-up-right')}</a>`:''}${writable?`<button type="button" data-github-refresh aria-label="Refresh from GitHub">${icon('refresh')}<span>Refresh</span></button>`:''}</span></div>`;
}
function bodyMarkup(n){
 if(n.type==='plan')return `<div class="card-main note-content"><div class="plan-body" contenteditable="plaintext-only" role="textbox" aria-label="Plan text" aria-multiline="true" data-edit="body">${escapeHTML(n.body)}</div></div><button type="button" class="chat-preview-toggle note-preview-toggle" aria-expanded="${expandedNotes.has(n.id)}">${expandedNotes.has(n.id)?'Show less':'Show full note'} ${icon('nav-arrow-down')}</button><div class="card-footer"><span class="author">${personMarkup(n.authorProfile)||escapeHTML(n.author||'You')}</span><span class="node-status">v${n.revision}</span></div>`;
 if(n.type==='thread')return `<div class="chat-surface" role="region" aria-label="Conversation transcript" tabindex="${compactChat(n)?-1:0}"><div class="messages">${n.messages.map(m=>`<div class="message ${m.role}" data-message="${m.id}"><div class="message-label"><span class="sr-only">${m.role==='user'?'You':m.model||'Previous demo reply'}</span>${messageNibMarkup(m)}</div><div data-message-text>${m.role==='user'?`<div class="user-message-copy">${personMarkup(m.person)}${messageHTML(m.text)}</div>`:messageHTML(m.text)}${m.error?`<div class="message-error" role="alert">${escapeHTML(m.error)} <button type="button" data-retry-message="${m.id}">Retry</button></div>`:''}</div></div>`).join('')}</div></div>${n.messages.length?`<button type="button" class="chat-preview-toggle" aria-expanded="${!compactChat(n)}">${compactChat(n)?'Show conversation':'Show less'} ${icon('nav-arrow-down')}</button>`:''}<form class="composer chat-composer"><div class="context-list">${(n.contexts||[]).map(contextMarkup).join('')}</div>${contextDetails(n)}<textarea data-prompt aria-label="Message in ${escapeHTML(n.title)}" placeholder="${n.agent?(n.messages.length?'Give a new research goal…':'Give your agent a goal…'):n.messages.length?'Continue the conversation…':'Ask anything…'}" rows="2">${escapeHTML(n.draft||'')}</textarea><div class="composer-controls"><button type="button" class="add-context" aria-label="Add context node" data-tooltip="Add context node" aria-haspopup="menu" aria-controls="context-menu" aria-expanded="false">${icon('plus')}</button><span class="mode-chip">${icon(n.agent?'flash':'chat-bubble')}<span>${n.agent?'Agent':'Chat'}</span></span>${modelPickerMarkup(n)}<button type="submit" class="send-message" aria-label="Send message" ${generatingChats.has(n.id)?'disabled':''}><span>${n.agent?'Run':'Send'}</span>${icon('arrow-up')}</button></div></form>`;
 if(n.type==='search')return searchMarkup(n);
 if(n.type==='media')return mediaMarkup(n);
 if(n.type==='upload')return uploadMarkup(n);
 if(n.type==='github')return githubMarkup(n);
 if(n.researchSource)return `<div class="research-source-body"><span>${icon('link')}Research source</span><a href="${escapeHTML(n.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(n.url)}</a><small>Discovered by ${escapeHTML(nodeById(n.autoGroup)?.agentName||'your agent')} · cited findings stay in the conversation</small></div>`;
 return websiteMarkup(n);
}
const websiteFallbacks=new Set();
const websiteMonitors=new Map(),websiteChecks=new Map();
function showWebsiteFallback(frame){
 const n=nodeById(frame.closest('.card')?.dataset.node);
 if(!frame.isConnected||!n)return;
 websiteFallbacks.add(n.id);
 const template=document.createElement('template');template.innerHTML=websiteMarkup(n);
 frame.closest('.website-preview').replaceWith(template.content.firstElementChild);
 monitorWebsitePreviews();requestDraw();
}
function monitorWebsitePreviews(){
 for(const [frame,stop]of websiteMonitors)if(!frame.isConnected){stop();websiteMonitors.delete(frame);}
 for(const frame of $$('.website-viewport iframe')){
  if(websiteMonitors.has(frame))continue;
  let timer,observer,started=false,loaded=false,stopped=false;
  const fail=()=>{if(!stopped)showWebsiteFallback(frame);};
  const onLoad=()=>{loaded=true;clearTimeout(timer);};
  frame.addEventListener('load',onLoad);frame.addEventListener('error',fail);
  websiteMonitors.set(frame,()=>{stopped=true;clearTimeout(timer);observer?.disconnect();frame.removeEventListener('load',onLoad);frame.removeEventListener('error',fail);});
  const start=()=>{
   if(started||stopped)return;started=true;observer?.disconnect();
   // Start the deadline only when a lazy preview enters the viewport.
   frame.loading='eager';if(!loaded)timer=setTimeout(fail,20000);
   if(location.protocol==='https:'&&frame.src.startsWith('http:')){fail();return;}
   const url=frame.src;let check=websiteChecks.get(url);
   if(!check||Date.now()-check.at>60000){
    const promise=(async()=>{try{const response=await fetch('/api/embed-check',{method:'POST',headers:{'Content-Type':'application/json',...window.BoardShared?.headers?.()},body:JSON.stringify({url}),signal:AbortSignal.timeout(10000)});return response.ok?await response.json():null;}catch{return null;}})();
    check={at:Date.now(),promise};websiteChecks.set(url,check);
    if(websiteChecks.size>100)websiteChecks.delete(websiteChecks.keys().next().value);
   }
   check.promise.then(result=>{if(result?.status==='blocked'||result?.status==='unavailable')fail();});
  };
  if(typeof IntersectionObserver==='function'){observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))start();});observer.observe(frame);}else start();
 }
}
function websiteMarkup(n){
 let url;try{url=new URL(n.url);if(!['http:','https:'].includes(url.protocol))return '';}catch{return '';}
 const domain=url.hostname.replace(/^www\./,''),sandbox='allow-scripts allow-forms allow-popups'+(url.origin!==location.origin?' allow-same-origin':'');
 return `<div class="website-preview"><div class="website-viewport">${websiteFallbacks.has(n.id)?`<div class="website-fallback" role="status">${icon('link')}<strong>${escapeHTML(domain)}</strong><p>This preview couldn’t load. The site may be unavailable or may not allow embedded previews. You can still open it in your browser and keep this node as a source.</p><a data-open-browser href="${escapeHTML(url.href)}" target="_blank" rel="noopener noreferrer">Open in browser ${icon('arrow-up-right')}</a><button type="button" data-retry-embed>Try preview again</button></div>`:`<iframe title="Interactive page: ${escapeHTML(domain)}" src="${escapeHTML(url.href)}" sandbox="${sandbox}" referrerpolicy="no-referrer" loading="lazy"></iframe>`}</div><div class="website-source">${icon('link')}<span>${escapeHTML(domain)}</span>${websiteFallbacks.has(n.id)?'':'<button type="button" data-embed-help>Preview not loading?</button>'}<a data-open-browser href="${escapeHTML(url.href)}" target="_blank" rel="noopener noreferrer" data-tooltip="Open in browser · use if embedding is blocked" aria-label="Open ${escapeHTML(domain)} in browser">Open in browser ${icon('arrow-up-right')}</a></div></div><section class="website-perspective" id="website-perspective-${n.id}" ${openWebsitePerspectives.has(n.id)?'':'hidden'}><label id="website-notes-label-${n.id}">Your perspective</label><div class="website-notes" contenteditable="plaintext-only" role="textbox" aria-labelledby="website-notes-label-${n.id}" aria-label="Website perspective notes" aria-multiline="true" data-edit="body" data-placeholder="What should AI know about how you’re using this site?">${escapeHTML(n.body||'')}</div></section>`;
}

// Semantic overview is presentation-only: original editors and node data stay intact.
function overviewMarkup(n){
 const type=n.agent?'Research agent':({plan:'Note',thread:'Chat',search:'Image search',web:'Website',upload:'File',github:'GitHub',media:n.mediaType==='video'?'Video':'Image'}[n.type]||'Node');
 const symbol={plan:'page',thread:'chat-bubble',search:'search',web:'arrow-up-right',upload:'attachment',github:'github',media:n.mediaType==='video'?'youtube':'media-image'}[n.type]||'page';
 return `<div class="node-overview"><span class="overview-icon" aria-hidden="true">${icon(symbol)}</span><div class="overview-label"><span class="overview-type">${type}</span><strong>${escapeHTML(n.title||'Untitled')}</strong></div></div>`;
}
function cardMarkup(n,i){const kind={plan:'Plan',thread:'Chat',search:'Search',web:'Source',upload:'File',media:'Media',github:'GitHub'}[n.type];const titleLabel=n.type==='plan'?'Plan title':n.type==='thread'?'Conversation title':'Card title';return `<article class="card ${lastHeldNode===n.id?'last-held':''} ${n.agent?'agent-card':''} ${n.researchSource?'research-source-card':''} ${n.autoGroup?'auto-group-member':''} ${n.type==='plan'&&!expandedNotes.has(n.id)?'compact-note':''} ${compactChat(n)?'compact-chat':''} ${n.type==='thread'&&!n.messages?.length&&!n.contexts?.length?'empty-chat':''} ${n.type==='web'?'web-card':''} ${n.type==='github'?'github-card':''} ${focused===n.id?'focused':''}" data-node="${n.id}" data-kind="${n.type}" data-bottom-ports="${!!n.bottomPorts}" aria-busy="${generatingChats.has(n.id)}" tabindex="0" aria-label="${escapeHTML(n.type+' card: '+n.title)}" style="--page-height:${n.minHeight||469}px;width:${n.width||(n.type==='web'?540:n.type==='thread'?520:380)}px;min-height:${n.minHeight||0}px;transform:translate3d(${n.x}px,${n.y}px,0)"><button class="title-grip" aria-label="Move ${escapeHTML(n.title)}"><span class="grip-dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span></button><div class="card-header"><h2 class="node-label" contenteditable="plaintext-only" role="textbox" aria-label="${titleLabel}" data-edit="title">${escapeHTML(n.title||'Untitled')}</h2><span class="drag-strip" aria-hidden="true"></span><div class="header-actions">${websitePerspectiveButton(n)}${sourceInfoButton(n)}${expandIdeaButton(n)}${n.type==='thread'?`<button class="open-chat-panel" aria-label="Open chat in side panel" data-tooltip="Open in side panel">${icon('arrow-up-right')}</button><button class="collapse-card" aria-label="${compactChat(n)?'Expand':'Collapse'} conversation" title="${compactChat(n)?'Expand':'Collapse'}" aria-expanded="${!compactChat(n)}">${icon('nav-arrow-down')}</button>`:''}<button class="delete-card" aria-label="Delete ${escapeHTML(n.title)}" title="Delete card">${icon('trash')}</button></div></div>${overviewMarkup(n)}${n.agent?agentIdentityMarkup(n):''}${bodyMarkup(n)}${['thread','upload','media','web','github'].includes(n.type)||n.contextFor?'':`<div class="node-controls"><button class="add-file" aria-label="Add file beside ${escapeHTML(n.title)}">${icon('plus')}</button><span class="mode-chip" title="${kind}" aria-label="${kind}"><span class="mode-icon">${icon({plan:'page',thread:'chat-bubble',search:'search',web:'arrow-up-right',upload:'upload',media:n.mediaType==='video'?'youtube':'media-image'}[n.type])}</span><span class="sr-only">${kind}</span></span><span class="node-byline">${n.type==='thread'?'AI demo':n.type==='plan'?escapeHTML(n.author||'You'):''}</span></div>`}${sourceInfoMarkup(n)}${ideaPreviewMarkup(n)}${n.type!=='search'?nibMarkup(n):''}${n.type==='thread'||n.contexts?.length||n.previewOrigin?`<span class="socket ${n.previewOrigin?'preview-input':''} ${n.contexts?.length||n.previewOrigin?'has-context':''}" role="img" aria-label="Incoming context"></span>`:''}<span class="drop-inline" aria-hidden="true">${icon('plus')}</span><button class="resize-handle" aria-label="Resize ${escapeHTML(n.title)}" title="Resize">${icon('resize-diagonal')}</button></article>`}
function render(){commitEdit();$('#chat-panel .card')?.remove();$('#cards').innerHTML=state.nodes.map(cardMarkup).join('');mountChatPanel();state.nodes.forEach(updateActivity);$('#board-title').textContent=state.title;$('#undo').disabled=!undoHistory.length;observeCards();requestDraw()}
function refreshCard(n){if(!window.BoardShared?.applying)commitEdit();const old=cardEl(n.id),reading=panelNodeId===n.id?old?.querySelector('.chat-surface'):null,readingTop=reading?.scrollTop,follow=reading?reading.scrollHeight-reading.scrollTop-reading.clientHeight<60:true,entrance=old?.getAnimations().find(a=>a.id==='idea-entrance'),entranceTime=entrance?.currentTime;if(old)old.outerHTML=cardMarkup(n,state.nodes.indexOf(n));else $('#cards').insertAdjacentHTML('beforeend',cardMarkup(n,state.nodes.indexOf(n)));if(entrance&&entranceTime<300){const next=cardEl(n.id),animation=next.animate(entrance.effect.getKeyframes(),{duration:300,easing:'cubic-bezier(.2,.8,.2,1)',id:'idea-entrance'});animation.currentTime=entranceTime;next.addEventListener('pointerdown',()=>animation.cancel(),{once:true});}mountChatPanel();if(reading){const area=cardEl(n.id)?.querySelector('.chat-surface');if(area)area.scrollTop=follow?area.scrollHeight:readingTop;}observeCards();requestDraw();if(!window.BoardShared?.applying)scheduleNodeTitle(n);window.BoardShared?.refreshLocks();updateActivity(n)}
function sourceText(n,cutoff){return BranchContext.textOf(n,cutoff)}
function contextSnapshot(source,quote='',cutoff=null){return{id:id(),...(quote?BranchContext.branchPayload(source,state.nodes,{quote,cutoff}).context:BranchContext.snapshotNode(source,state.nodes,{quote,cutoff}))}}
function addContext(source,target,quote='',cutoff=null){if(!BranchContext.canBranch(source,cutoff))return;if(source.id===target.id||target.type!=='thread')return;const exists=target.contexts.some(c=>c.source===source.id&&c.quote===quote&&(c.cutoff||null)===(cutoff||null));if(exists)return notify('This context is already attached');remember();target.contexts.push(contextSnapshot(source,quote,cutoff));target.revision++;refreshCard(target);record('Attached context');}
function freePosition(x,y,width=380){if(window.BranchAutoLayout)return BranchAutoLayout.place(measuredNodes(),{x,y},width,640);let bottom=y;for(const n of state.nodes)if(Math.abs(n.x-x)<width+64)bottom=Math.max(bottom,n.y+(cardEl(n.id)?.offsetHeight||640)+64);return{x,y:bottom}}
function newCard(type,p,context){remember();const loc=p||freePosition((innerWidth/2-camera.x)/camera.z-190,(150-camera.y)/camera.z);const n={id:id(),type,x:loc.x,y:loc.y,revision:1,title:type==='plan'?'Untitled plan':type==='thread'?'New conversation':'Research',author:'You'};if(type==='plan')n.body='';if(type==='thread'){n.contexts=context?[contextSnapshot(nodeById(context.source),context.quote,context.cutoff)]:[];n.messages=[];n.draft='';if(context?.quote)n.title=context.quote.replace(/[.!?]$/,'').slice(0,55);else if(context)n.title=nodeById(context.source).type==='thread'?nodeById(context.source).title+' / branch':'Explore '+nodeById(context.source).title}state.nodes.push(n);focused=n.id;refreshCard(n);record('Created '+type);hideSelection();showFirstUse(type);return n}
function createExcerptNote(quote,p){const n=newCard('plan',p);n.body=quote;n.title='Excerpt';expandedNotes.add(n.id);refreshCard(n);record('Created excerpt note');return n}
function createBranch(source,quote,p,cutoff=null){if(!BranchContext.canBranch(source,cutoff))return null;const n=newCard('thread',p,{source:source.id,quote,cutoff});const payload=BranchContext.branchPayload(source,state.nodes,{quote,cutoff});n.contexts=[{id:n.contexts[0].id,...payload.context}];n.draft=payload.draft;refreshCard(n);save();return n}

async function send(n,{focus=true}={}){
 if(window.BoardShared){if(!window.BoardShared.enabled)return notify('Shared board is still connecting');return window.BoardShared.send(n.id);}
 const text=n.draft?.trim();if(!text||generatingChats.has(n.id))return;
 let contexts;try{contexts=BranchVideoContext.hydrateVideos(clone(n.contexts),await prepareVideoTranscripts(n.contexts));}catch(error){return notify(error.message);}remember();const resolved=BranchContext.resolveContext(contexts);
 const messages=n.messages.filter(m=>!m.error&&m.text?.trim()).map(m=>({role:m.role,content:m.text}));messages.push({role:'user',content:text});
 const response={id:id(),role:'assistant',text:'',context:contexts,usedContext:resolved,model:'gpt-5.4-mini'};
 const controller=new AbortController();n.messages.push({id:id(),role:'user',text,context:contexts},response);n.draft='';n.activity='thinking';n.revision++;generatingChats.set(n.id,controller);refreshCard(n);updateActivity(n);record('Asked gpt-5.4-mini');if(focus)cardEl(n.id).querySelector('[data-prompt]')?.focus({preventScroll:true});
 try{
  const result=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json',...window.BoardShared?.headers()},body:JSON.stringify({modelStage:n.modelStage,messages,contexts:resolved}),signal:controller.signal});
  if(!result.ok){const error=await result.json().catch(()=>({}));throw Error(error.error||'The local AI server is unavailable.');}
  const reader=result.body.getReader(),decoder=new TextDecoder();let buffer='',completed=false;
  while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});let split;while((split=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,split);buffer=buffer.slice(split+1);if(!line.trim())continue;const event=JSON.parse(line);if(generatingChats.get(n.id)!==controller||nodeById(n.id)!==n){controller.abort();return;}
   if(event.type==='activity'){n.activity=event.activity;updateActivity(n);}
   else if(event.type==='delta'){response.text+=event.text;const content=cardEl(n.id)?.querySelector(`[data-message="${response.id}"] [data-message-text]`);if(content){renderStreamText(content,response.text);const message=content.closest('.message');if(!message.querySelector('.message-branch'))message.querySelector('.message-label').insertAdjacentHTML('beforeend',messageNibMarkup(response));}requestDraw();}
   else if(event.type==='error')throw Error(event.message);
   else if(event.type==='done'){completed=true;if(typeof event.text==='string'){response.text=event.text;const target=cardEl(n.id)?.querySelector(`[data-message="${response.id}"] [data-message-text]`);if(target)renderStreamText(target,response.text);}response.responseId=event.responseId;response.model=event.model;}
  }}
  if(!completed)throw Error('The response ended early. Please retry.');
 }catch(error){if(error.name!=='AbortError'&&nodeById(n.id)===n){response.error=error.message;response.retryPrompt=text;refreshCard(n);notify(error.message);}}
 finally{if(generatingChats.get(n.id)===controller){generatingChats.delete(n.id);delete n.activity;updateActivity(n);if(nodeById(n.id)===n){const card=cardEl(n.id);card?.setAttribute('aria-busy','false');const button=card?.querySelector('.send-message');if(button)button.disabled=false;save();}requestDraw();}}
}

function openURL(raw,source,link=null,animate=false,position=null,releaseRect=null){const vid=BranchMedia.videoId(raw);if(vid&&!link)return addMediaCard({type:'video',id:vid,title:'YouTube video',source:'https://www.youtube.com/watch?v='+vid},source);let url;try{url=new URL(raw);if(!['https:','http:'].includes(url.protocol))throw Error()}catch{return notify('Use a complete http or https URL')};remember();const p=position||freePosition(source.x+(source.width||520)+60,source.y,540);const n={id:id(),type:'web',title:url.hostname.replace(/^www\./,''),url:url.href,x:p.x,y:p.y,revision:1,...(vid?{type:'media',mediaType:'video',videoId:vid,source:url.href,width:540}:{})};if(link)n.previewOrigin=previewOrigin(source,link);state.nodes.push(n);refreshCard(n);record('Opened page node');if(panelNodeId){expandedChats.add(source.id);closeChatPanel();}if(!position)revealDockNode(n);if(animate)expandLinkPreview(n,releaseRect);requestDraw();notify('Page opened beside its source')}
// Visual provenance is metadata, never an implicit AI context attachment.
function previewOrigin(source,link){
 const message=link.closest('[data-message]')?.dataset.message||null;
 const scope=link.closest('[data-message]')||cardEl(source.id);
 const matches=[...scope.querySelectorAll('a[href]')].filter(a=>a.href===link.href);
 return {source:source.id,message,url:link.href,occurrence:matches.indexOf(link)};
}
function previewLink(n){
 const origin=n.previewOrigin,source=origin&&nodeById(origin.source);
 if(!source||collapsedWorkspaceMember(source)||collapsedAgentSource(source))return null;
 const card=cardEl(source.id);
 const scope=origin.message?[...card?.querySelectorAll('[data-message]')||[]].find(el=>el.dataset.message===origin.message):card;
 return [...scope?.querySelectorAll('a[href]')||[]].filter(a=>a.href===origin.url)[origin.occurrence]||null;
}
function previewLinkRect(link){
 if(!link)return null;
 const rects=[...link.getClientRects()].filter(r=>r.width>0&&r.height>0);
 const r=rects.at(-1);if(!r)return null;
 // A collapsed transcript must not produce an endpoint from clipped text.
 for(let parent=link.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
  const style=getComputedStyle(parent);
  if(['hidden','auto','scroll','clip'].includes(style.overflowY)){
   const bounds=parent.getBoundingClientRect();
   if(r.top+r.height/2<bounds.top||r.top+r.height/2>bounds.bottom)return null;
  }
 }
 return r;
}
const previewEntrances=new Set();
let suppressedPreviewClick=null;
function expandLinkPreview(n,releaseRect=null){
 const card=cardEl(n.id),origin=releaseRect||previewLinkRect(previewLink(n));
 if(reduced.matches||!card?.animate||!origin)return;
 const end=card.getBoundingClientRect();if(!end.width||!end.height)return;
 const transform=card.style.transform;
 const dx=(origin.left-end.left)/camera.z,dy=(origin.top-end.top)/camera.z;
 card.style.transformOrigin='0 0';
 const animation=card.animate([
  {transform:`translate3d(${n.x+dx}px,${n.y+dy}px,0) scale(${origin.width/end.width},${origin.height/end.height})`,opacity:.65},
  {transform,opacity:1}
 ],{duration:280,easing:'cubic-bezier(.2,.8,.2,1)'});
 previewEntrances.add(animation);
 const cancel=()=>animation.cancel();card.addEventListener('pointerdown',cancel,{once:true});
 const done=()=>{previewEntrances.delete(animation);card.style.removeProperty('transform-origin');card.removeEventListener('pointerdown',cancel);requestDraw();};
 animation.onfinish=done;animation.oncancel=done;requestDraw();
}
function previewWireSegments(){
 const segments=[];
 document.querySelectorAll('.preview-link-connected').forEach(link=>link.classList.remove('preview-link-connected'));
 for(const node of state.nodes){
  if(!node.previewOrigin||collapsedWorkspaceMember(node))continue;
  const link=previewLink(node),r=previewLinkRect(link);
  if(!r)continue;
  const end=elementPoint(cardEl(node.id)?.querySelector(':scope > .socket'));if(!end)continue;
  link.classList.add('preview-link-connected');
  segments.push({d:curve({x:r.right+3*camera.z,y:r.top+r.height/2-boardTop()},end),kind:'wire-base preview-wire'});
 }
 return segments;
}
function deleteNode(n){if(window.BoardShared?.enabled){commitEdit();return window.BoardShared.deleteNode(n.id);}expandingIdeas.get(n.id)?.abort();clearTimeout(titleTimers.get(n.id));titleTimers.delete(n.id);titleRequests.get(n.id)?.abort();generatingChats.get(n.id)?.abort();generatingChats.delete(n.id);remember();state.nodes=state.nodes.filter(x=>x.id!==n.id);state.nodes.forEach(x=>{if(x.contexts)x.contexts=x.contexts.filter(c=>c.source!==n.id)});cardSprings.delete(n.id);render();record('Deleted card');notify('Card removed · undo available')}
function detach(n,cid){remember();n.contexts=n.contexts.filter(c=>c.id!==cid);openContexts.delete(cid);refreshCard(n);record('Detached context');notify('Context detached')}
function boardTop(){return $('#board').getBoundingClientRect().top}
function boardPoint(clientX,clientY){return{x:(clientX-camera.x)/camera.z,y:(clientY-boardTop()-camera.y)/camera.z}}
function screenPoint(x,y){return{x:x*camera.z+camera.x,y:y*camera.z+camera.y}}
function applyCamera(){ const world=$('#world');if(camera.z<.25&&!world.classList.contains('zoomed-out')){for(const n of state.nodes){const summary=cardEl(n.id)?.querySelector('.node-overview');if(summary)summary.outerHTML=overviewMarkup(n);}}world.classList.toggle('zoomed-out',camera.z<.25);reactiveGrid.setCamera(camera); $('#world').style.transform=`translate3d(${camera.x}px,${camera.y}px,0) scale(${camera.z})`;const gridStep=24*camera.z;$('#dot-grid').setAttribute('patternTransform',`translate(${camera.x%gridStep} ${camera.y%gridStep}) scale(${camera.z})`);$('#grid-dot').setAttribute('r',.7/camera.z);$('#zoom').textContent=Math.round(camera.z*100)+'%';document.dispatchEvent(new Event('branch-camera'));requestDraw()}
function zoomAt(factor,x=innerWidth/2,y=innerHeight/2){const before=boardPoint(x,y);camera.z=Math.max(.1,Math.min(3,camera.z*factor));camera.x=x-before.x*camera.z;camera.y=y-boardTop()-before.y*camera.z;applyCamera();hideSelection()}
function fit(){stopAllSprings();if(!state.nodes.length)return;syncAgentStacks();const bounds=state.nodes.filter(n=>!collapsedAgentSource(n)).map(n=>({x:n.x,y:n.y,w:n.width||(n.type==='web'?540:n.type==='thread'?520:380),h:cardEl(n.id)?.offsetHeight||300}));for(const n of state.nodes.filter(n=>n.agent&&!collapsedAgentWorkspaces.has(n.id)&&agentSources(n).length))bounds.push(agentStackBounds(n));const left=Math.min(...bounds.map(n=>n.x)),top=Math.min(...bounds.map(n=>n.y)),right=Math.max(...bounds.map(n=>n.x+n.w)),bottom=Math.max(...bounds.map(n=>n.y+n.h));camera.z=Math.max(.1,Math.min(1,(innerWidth-130)/(right-left),(innerHeight-190)/(bottom-top)));camera.x=(innerWidth-(right-left)*camera.z)/2-left*camera.z;camera.y=(innerHeight-135-(bottom-top)*camera.z)/2-top*camera.z;applyCamera()}
function elementPoint(el){if(!el)return null;const r=el.getBoundingClientRect();if(!r.width||!r.height)return null;return{x:r.left+r.width/2,y:r.top+r.height/2-boardTop()};}
function portPoint(n,incoming=false,contextId=null){const el=document.querySelector(`[data-panel-placeholder="${n.id}"]`)||cardEl(n.id);const port=incoming?el?.querySelector(':scope > .socket'):contextId?el?.querySelector(`[data-context="${contextId}"]`):el?.querySelector(':scope > .nib');const measured=elementPoint(port);if(measured)return measured;const r=el?.getBoundingClientRect();return r&&r.width&&r.height?{x:incoming?r.left-12:r.right+18,y:r.top+Math.min(64,r.height/2)-boardTop()}:screenPoint(n.x+(incoming?0:(n.width||380)),n.y+40);}

function wirePoints(a,b,bend=0){const dx=b.x-a.x,dy=b.y-a.y,len=Math.max(1,Math.hypot(dx,dy));return [a,...Array.from({length:7},(_,i)=>{const t=(i+1)/8,offset=Math.sin(t*Math.PI*2)*Math.min(4,len*.012)+bend*Math.sin(t*Math.PI);return{x:a.x+dx*t-dy/len*offset,y:a.y+dy*t+dx/len*offset};}),b];}
function wirePath(points){let d=`M${points[0].x},${points[0].y}`;for(let i=1;i<points.length-1;i++){const p=points[i],q=points[i+1];d+=` Q${p.x},${p.y} ${(p.x+q.x)/2},${(p.y+q.y)/2}`;}const end=points[points.length-1];return d+` T${end.x},${end.y}`;}
function curve(a,b){return wirePath(wirePoints(a,b));}

function syncConnectionCandidates(){const g=gesture,active=g&&(g.kind==='context'||g.kind==='excerpt'&&g.moved);for(const card of $$('.card[data-kind="thread"]'))card.classList.toggle('connection-candidate',!!active&&card.dataset.node!==g.source&&card.dataset.node!==g.originNode);}
function drawWires(){syncConnectionCandidates();syncAgentStacks();drawAutoGroups();syncConnectedNibs();const segments=previewWireSegments();state.nodes.forEach(n=>{(n.contexts||[]).forEach(c=>{const source=nodeById(c.source);if(!source||collapsedWorkspaceMember(source)||collapsedAgentSource(n))return;const origin=null,messagePort=c.cutoff&&source.id!==panelNodeId?cardEl(source.id)?.querySelector(`[data-branch-point="${c.cutoff}"] .context-pill`):null;const listPort=collapsedAgentSource(source)?document.querySelector(`[data-source-row="${source.id}"] .source-row-port`):null;const start=elementPoint(listPort)||(origin?portPoint(origin,false,c.originContext):quotePortPoint(source,c.quote)||elementPoint(messagePort)||portPoint(source));const d=curve(start,portPoint(n,true,c.id));segments.push({d,kind:c.enabled&&generatingChats.has(n.id)?'wire-flow':'wire-base'})})});const group=$('#permanent-wires');while(group.children.length>segments.length)group.lastChild.remove();segments.forEach((segment,i)=>{let path=group.children[i];if(!path){path=document.createElementNS('http://www.w3.org/2000/svg','path');group.append(path)}path.setAttribute('d',segment.d);path.setAttribute('class',segment.kind)})}
function requestDraw(){if(!frame)frame=requestAnimationFrame(tick)}
function springStep(p,target,dt,k=260,d=31){const a=k*(target-p.value)-d*p.velocity;p.velocity+=a*dt;p.value+=p.velocity*dt;return p.value}
function tick(time){frame=0;const dt=Math.min(.025,Math.max(.001,(time-(lastFrame||time-16))/1000));lastFrame=time;let keep=false;for(const [nid,s]of cardSprings){const n=nodeById(nid);if(!n){cardSprings.delete(nid);continue}n.x=springStep(s.x,s.tx,dt);n.y=springStep(s.y,s.ty,dt);cardEl(nid).style.transform=`translate3d(${n.x}px,${n.y}px,0)`;if(Math.hypot(n.x-s.tx,n.y-s.ty)<.08&&Math.hypot(s.x.velocity,s.y.velocity)<.5){n.x=s.tx;n.y=s.ty;cardSprings.delete(nid);save()}else keep=true}drawWires();if(previewEntrances.size)keep=true;if(wire){drawLiveWire(dt);keep=true}if(keep)requestDraw()}
function stopAllSprings(){cardSprings.clear();save()}
function drawLiveWire(dt){const a=wire.start(),b=wire.target;let endX=b.x,endY=b.y;if(wire.magnet&&!reduced.matches){endX=springStep(wire.ex,b.x,dt,420,40);endY=springStep(wire.ey,b.y,dt,420,40)}else{wire.ex.value=endX;wire.ey.value=endY;wire.ex.velocity=0;wire.ey.velocity=0}wire.bend*=Math.exp(-10*dt);const pts=wirePoints(a,{x:endX,y:endY},wire.bend);for(let i=1;i<pts.length-1;i++){const p=pts[i],s=wire.points[i-1];if(!reduced.matches){p.x=springStep(s.x,p.x,dt,440,42);p.y=springStep(s.y,p.y,dt,440,42);}}const d=wirePath(pts);$('#live-wire').setAttribute('d',d);$('#wire-end').setAttribute('cx',endX);$('#wire-end').setAttribute('cy',endY);$('#live-wire').style.stroke=wire.magnet?'#254bd1':'#4879f5';$('#wire-end').style.fill=wire.magnet?'#254bd1':'#4879f5'}
function startWire(source,x,y,fromPointer=false,anchor=null,quote=''){const sourceNode=nodeById(source),local=boardPoint(x,y),offset={x:local.x-sourceNode.x,y:local.y-sourceNode.y};const start=()=>{const n=nodeById(source);return quotePortPoint(n,quote)||(anchor?.isConnected?elementPoint(anchor):fromPointer?screenPoint(n.x+offset.x,n.y+offset.y):portPoint(n))};const a=start(),b={x,y:y-boardTop()};wire={start,target:b,ex:{value:b.x,velocity:0},ey:{value:b.y,velocity:0},magnet:false,bend:0,points:Array.from({length:7},(_,i)=>{const t=(i+1)/8;return{x:{value:a.x+(b.x-a.x)*t,velocity:0},y:{value:a.y+(b.y-a.y)*t,velocity:0}}})};document.body.classList.add('connecting');requestDraw()}
function findTarget(g,x,y){let best=null,bestD=Infinity;for(const n of state.nodes){if(n.id===g.source||n.id===g.originNode)continue;if(n.type!=='thread')continue;const r=cardEl(n.id).getBoundingClientRect(),pad=38;const dx=Math.max(r.left-x,0,x-r.right),dy=Math.max(r.top-y,0,y-r.bottom),d=Math.hypot(dx,dy);if(d<pad&&d<bestD){best=n;bestD=d}}return best}
function showDragCaption(g,x,y,target){const el=$('#drag-caption');el.hidden=true;}
function clearTargets(){$$('.card.target').forEach(c=>c.classList.remove('target'))}
function hideSelection(){clearRoundedSelection();selection=null;$$('.selection-draggable').forEach(el=>el.classList.remove('selection-draggable'))}
function cancelGesture(){if(gesture){const g=gesture;if(g.kind==='move'){for(const item of g.members||[{id:g.source,x:g.ox,y:g.oy}]){const n=nodeById(item.id);if(n){n.x=item.x;n.y=item.y;positionCard(n);}}}if(g.kind==='resize'){const n=nodeById(g.source);n.width=g.ow;n.minHeight=g.oh;refreshCard(n)}if(g.kind==='pan'){camera.x=g.ox;camera.y=g.oy;applyCamera()}}finishGesture()}
function finishGesture(){if(gesture?.kind==='agent'){if(gesture.moved)suppressAgentDockClickUntil=performance.now()+500;$('#agent-drag-preview')?.remove();creationDock.classList.remove('agent-in-hand');}if(gesture?.kind==='link'&&gesture.moved)suppressedPreviewClick={link:gesture.link,until:performance.now()+500};$('#link-ghost')?.remove();document.body.classList.remove('dragging-link');gesture=null;wire=null;syncConnectionCandidates();document.body.classList.remove('connecting','panning','dragging-card');$$('.card.dragging').forEach(el=>el.classList.remove('dragging'));$('#drag-caption').hidden=true;$('#branch-ghost').hidden=true;$('#media-ghost')?.remove();clearTargets();requestDraw()}
function startGesture(e,g){if((g.kind==='context'||g.kind==='excerpt')&&!BranchContext.canBranch(nodeById(g.source),g.cutoff))return;if(gesture||e.button!==0||e.isPrimary===false)return;e.preventDefault();e.stopPropagation();document.activeElement?.blur();commitEdit();const n=nodeById(g.source);if(n&&(g.kind==='move'||g.kind==='resize'))raiseHeldNode(n.id);if(n)cardSprings.delete(n.id);const members=g.kind==='move'?groupMoveMembers(n).map(member=>({id:member.id,x:member.x,y:member.y})):undefined;if(members)for(const item of members)cardSprings.delete(item.id);gesture={...g,members,pointer:e.pointerId,sx:e.clientX,sy:e.clientY,lastX:e.clientX,lastY:e.clientY,lastTime:performance.now(),vx:0,vy:0,moved:false,before:clone(state)};e.target.setPointerCapture(e.pointerId);if(g.kind==='context')startWire(g.source,e.clientX,e.clientY,!!g.quote,e.target.closest('[data-context-port],[data-branch-point],.nib')?.querySelector('.context-pill')||e.target.closest('[data-branch-point],.nib'),g.quote||'');if(g.kind==='move'){cardEl(g.source).classList.add('dragging');document.body.classList.add('dragging-card')}if(g.kind==='pan')document.body.classList.add('panning')}
function onPointerMove(e){const g=gesture;if(!g||g.pointer!==e.pointerId)return;const dx=e.clientX-g.sx,dy=e.clientY-g.sy;const now=performance.now(),dt=Math.max(1,now-g.lastTime);g.vx=(e.clientX-g.lastX)/dt*1000;g.vy=(e.clientY-g.lastY)/dt*1000;g.lastX=e.clientX;g.lastY=e.clientY;g.lastTime=now;if(!g.moved&&Math.hypot(dx,dy)<(['link','excerpt'].includes(g.kind)?7:4))return;g.moved=true;if(g.kind==='agent'){updateAgentDrag(g,e.clientX,e.clientY);return;}if(g.kind==='link'||g.kind==='excerpt'){updateLinkGhost(g,e.clientX,e.clientY);return;}if(g.kind==='media'){updateMediaGhost(g,e.clientX,e.clientY);return;}if(g.kind==='resize'){const n=nodeById(g.source);n.width=Math.max(280,Math.min(1200,g.ow+dx/camera.z));n.minHeight=Math.max(160,Math.min(1800,g.oh+dy/camera.z));const el=cardEl(n.id);el.style.width=n.width+'px';el.style.minHeight=n.minHeight+'px';el.style.setProperty('--page-height',n.minHeight+'px');requestDraw();return}if(g.kind==='move'){for(const item of g.members||[]){const n=nodeById(item.id);if(n){n.x=item.x+dx/camera.z;n.y=item.y+dy/camera.z;positionCard(n);}}requestDraw();return}if(g.kind==='pan'){camera.x=g.ox+dx;camera.y=g.oy+dy;applyCamera();return}if(g.kind==='detach'){showDragCaption(g,e.clientX,e.clientY);return}clearTargets();const target=findTarget(g,e.clientX,e.clientY);g.target=target?.id;if(target)cardEl(target.id).classList.add('target');updateBranchGhost(g,e.clientX,e.clientY,target);wire.magnet=!!target;wire.target=target?portPoint(target,true):{x:e.clientX,y:e.clientY-boardTop()};wire.bend=Math.max(-9,Math.min(9,(g.vy-g.vx)*.004));showDragCaption(g,e.clientX,e.clientY,target);requestDraw()}
function onPointerUp(e){const g=gesture;if(!g||g.pointer!==e.pointerId)return;const moved=g.moved,target=nodeById(g.target),source=nodeById(g.source),releaseRect=['link','excerpt'].includes(g.kind)?$('#link-ghost')?.getBoundingClientRect():null;finishGesture();if(g.kind==='agent'){if(moved&&g.previewPoint&&validMediaDrop(e.clientX,e.clientY)&&(!window.BoardShared?.enabled||window.BoardShared.writable))placeDockAgent(g.previewPoint);return;}if(g.kind==='excerpt'){if(moved&&source&&(!window.BoardShared?.enabled||window.BoardShared.writable)){if(target)addContext(source,target,g.quote);else if(g.previewPoint&&validMediaDrop(e.clientX,e.clientY)){const n=createExcerptNote(g.quote,g.previewPoint);if(n){if(panelNodeId){expandedChats.add(source.id);closeChatPanel();}expandLinkPreview(n,releaseRect);}}hideSelection();getSelection().removeAllRanges();}return;}if(g.kind==='link'){if(moved&&source&&g.previewPoint&&validMediaDrop(e.clientX,e.clientY)&&(!window.BoardShared?.enabled||window.BoardShared.writable))openURL(g.url,source,g.link,true,g.previewPoint,releaseRect);return;}if(g.kind==='media'){if(moved){suppressMediaClickUntil=performance.now()+500;if(g.previewPoint&&validMediaDrop(e.clientX,e.clientY))addMediaCard(g.item,source,g.previewPoint);}return;}if(!moved){if(g.kind==='detach'){openContexts.has(g.context)?openContexts.delete(g.context):openContexts.add(g.context);refreshCard(source)}return}if(g.kind==='resize'){undoHistory.push(g.before);future=[];$('#undo').disabled=false;record('Resized card');return}if(g.kind==='move'){undoHistory.push(g.before);future=[];window.BoardShared?.moveNodes?.((g.members||[]).map(item=>nodeById(item.id)).filter(Boolean));record('Moved card');$('#undo').disabled=false;return}if(g.kind==='pan')return;if(g.kind==='detach'){const r=cardEl(source.id).getBoundingClientRect();if(e.clientX<r.left-12||e.clientX>r.right+12||e.clientY<r.top-12||e.clientY>r.bottom+12)detach(source,g.context);return}if(g.binding){const hit=document.elementFromPoint(e.clientX,e.clientY);if(target)branchContextBinding(g,target);else if(e.clientY>75&&e.clientY<innerHeight-75&&!hit?.closest('.card,header,nav,footer'))branchContextBinding(g,null,boardPoint(e.clientX,e.clientY));hideSelection();return;}if(target){addContext(source,target,g.quote||'',g.cutoff);hideSelection()}else{const hit=document.elementFromPoint(e.clientX,e.clientY);if(e.clientY>75&&e.clientY<innerHeight-75&&!hit?.closest('.card,header,nav,footer'))createBranch(source,g.quote||'',g.previewPoint||boardPoint(e.clientX,e.clientY),g.cutoff);}}
onCardEvent('pointerdown',e=>{
 const clickedCard=e.target.closest('.card');
 if(clickedCard&&e.button===0&&e.isPrimary!==false)raiseHeldNode(clickedCard.dataset.node);
 if(window.BoardShared?.enabled&&!window.BoardShared.writable)return;
 const card=e.target.closest('.card');if(!card)return;const n=nodeById(card.dataset.node);focused=n.id;$$('.card.focused').forEach(el=>el.classList.remove('focused'));card.classList.add('focused');
 if(camera.z<.25&&card.closest('#world'))return startGesture(e,{kind:'move',source:n.id,ox:n.x,oy:n.y});
 if(selection&&selection.source===n.id&&!e.shiftKey&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&e.detail<2){const selected=getSelection();if(selected.rangeCount&&selected.toString().trim()===selection.quote){const range=selected.getRangeAt(0),rects=[...range.getClientRects()].filter(r=>r.width&&r.height);const hit=rects.find(r=>e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom);if(hit){const r=range.getBoundingClientRect();return startGesture(e,{kind:'excerpt',source:n.id,quote:selection.quote,offsetX:(e.clientX-r.left)/camera.z,offsetY:(e.clientY-r.top)/camera.z,boxWidth:r.width/camera.z,boxHeight:r.height/camera.z});}}}
 const link=e.target.closest('a[data-node-link]');if(link&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){const r=link.getBoundingClientRect();return startGesture(e,{kind:'link',source:n.id,link,url:link.href,offsetX:(e.clientX-r.left)/camera.z,offsetY:(e.clientY-r.top)/camera.z,boxWidth:r.width/camera.z,boxHeight:r.height/camera.z});}
 const result=e.target.closest('[data-media-result]');if(result){const item=n.mediaResults?.[+result.dataset.mediaResult];if(item){const r=result.getBoundingClientRect();return startGesture(e,{kind:'media',source:n.id,item:clone(item),offsetX:(e.clientX-r.left)/camera.z,offsetY:(e.clientY-r.top)/camera.z});}}
 if(e.target.closest('#chat-panel')&&!e.target.closest('[data-branch-point],.nib'))return;
 if(e.target.closest('.title-grip'))return startGesture(e,{kind:'move',source:n.id,ox:n.x,oy:n.y});
 if(e.target.closest('.resize-handle'))return startGesture(e,{kind:'resize',source:n.id,ow:card.offsetWidth,oh:card.offsetHeight});
 if(e.target.closest('[data-branch-point]'))return startGesture(e,{kind:'context',source:n.id,cutoff:e.target.closest('[data-branch-point]').dataset.branchPoint});
 if(e.target.closest('.nib'))return startGesture(e,{kind:'context',source:n.id});
 if(e.target.closest('[data-context]'))return;
 if(e.target.closest('.card-header')&&!e.target.closest('button,[contenteditable]'))return startGesture(e,{kind:'move',source:n.id,ox:n.x,oy:n.y});
 if(e.target.closest('.idea-preview'))return;

});
$('#board').addEventListener('pointerdown',e=>{if(e.target.closest('.card,[data-agent-stack]'))return;hideSelection();$('#create-menu').hidden=true;startGesture(e,{kind:'pan',ox:camera.x,oy:camera.y})});
document.addEventListener('pointermove',onPointerMove);document.addEventListener('pointerup',onPointerUp);document.addEventListener('pointercancel',cancelGesture);window.addEventListener('blur',()=>{if(gesture)cancelGesture()});
$('#board').addEventListener('wheel',e=>{
 if(gesture)return;
 if(e.target.closest('branch-pdf'))return;
 if(e.ctrlKey||e.metaKey){e.preventDefault();zoomAt(Math.exp(-e.deltaY*.008),e.clientX,e.clientY);return}
 const horizontal=e.target.closest('.markdown-table,pre');
 if(horizontal&&horizontal.scrollWidth>horizontal.clientWidth+1&&(Math.abs(e.deltaX)>Math.abs(e.deltaY)||e.shiftKey))return;
 const scrollable=e.target.closest('textarea,blockquote,pre');
 if(scrollable&&scrollable.scrollHeight>scrollable.clientHeight+1&&Math.abs(e.deltaY)>Math.abs(e.deltaX)){const canScroll=e.deltaY>0?scrollable.scrollTop+scrollable.clientHeight<scrollable.scrollHeight-1:scrollable.scrollTop>0;if(canScroll)return}
 e.preventDefault();hideSelection();$('#create-menu').hidden=true;const unit=e.deltaMode===1?16:e.deltaMode===2?innerHeight:1;camera.x-=e.deltaX*unit;camera.y-=e.deltaY*unit;applyCamera();
},{passive:false});
function updateSelectionHandle(){
 if(gesture)return;const selected=getSelection();if(!selected.rangeCount||!selected.toString().trim()){hideSelection();return;}
 const content=selectionContent(selected.anchorNode);if(!content||!content.contains(selected.focusNode)){hideSelection();return;}
 const node=nodeById(content.closest('.card').dataset.node);selection={source:node.id,quote:selected.toString().trim()};const rects=[...selected.getRangeAt(0).getClientRects()].filter(r=>r.width&&r.height&&r.right>0&&r.left<innerWidth&&r.bottom>70&&r.top<innerHeight);paintRoundedSelection(content,rects);
}
document.addEventListener('selectionchange',updateSelectionHandle);
document.addEventListener('scroll',()=>{updateSelectionHandle();requestDraw();},true);
onCardEvent('dragstart',e=>e.preventDefault());
onCardEvent('focusin',rememberEditing);
onCardEvent('focusout',e=>{if(e.target.matches('[data-edit]'))commitEdit()});
onCardEvent('input',e=>{const n=nodeById(e.target.closest('.card')?.dataset.node);if(!n)return;if(e.target.matches('[data-idea-prompt]')){const preview=ideaPreviews.get(n.id);if(preview?.ideas)preview.ideas[+e.target.dataset.ideaPrompt].prompt=e.target.value;return;}if(e.target.dataset.edit){if(e.target.dataset.edit==='title')n.titleEdited=true;n[e.target.dataset.edit]=e.target.innerText;window.BoardShared?.edit(n,e.target.dataset.edit,e.target.innerText);syncNib(n);if(n.type==='web'){const detail=cardEl(n.id)?.querySelector('.source-context-detail pre');if(detail)detail.textContent=sourceText(n);}$('#save-state').textContent='Editing';requestDraw()}if(e.target.matches('[data-prompt]')){n.draft=e.target.value;window.BoardShared?.edit(n,'draft',n.draft);save()}if(e.target.matches('[data-query]')){n.query=e.target.value;save()}});
onCardEvent('click',async e=>{
 const n=nodeById(e.target.closest('.card')?.dataset.node);if(!n)return;
 const link=e.target.closest('a[href]');
 if(link&&suppressedPreviewClick?.link===link&&performance.now()<suppressedPreviewClick.until){e.preventDefault();return;}
 if(link&&!e.defaultPrevented&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey&&!link.matches('[data-open-browser],[download],.file-image-link')&&['http:','https:'].includes(new URL(link.href).protocol)){
  if(window.BoardShared?.enabled&&!window.BoardShared.writable)return;
  e.preventDefault();openURL(link.href,n,link,e.detail>0);return;
 }
 if(e.target.closest('[data-embed-help]')){websiteFallbacks.add(n.id);refreshCard(n);return;}
 if(e.target.closest('[data-retry-embed]')){try{websiteChecks.delete(new URL(n.url).href);}catch{}websiteFallbacks.delete(n.id);refreshCard(n);return;}
 if(e.target.closest('[data-workspace-toggle]')){collapsedAgentWorkspaces.has(n.id)?collapsedAgentWorkspaces.delete(n.id):collapsedAgentWorkspaces.add(n.id);syncAgentStacks();settleAutomaticNodes();requestDraw();return;}
 if(e.target.closest('[data-stop-agent]')){if(window.BoardShared?.enabled)await window.BoardShared.stop(n.id);else generatingChats.get(n.id)?.abort();return;}
 if(e.target.closest('[data-website-perspective]')){toggleWebsitePerspective(n,!openWebsitePerspectives.has(n.id));return;}
 if(e.target.closest('[data-source-info]')){openContextInspector(n);return;}
 if(e.target.closest('[data-expand-idea]')){expandIdea(n,e);return;}
 if(e.target.closest('[data-close-ideas]')){expandingIdeas.get(n.id)?.abort();ideaPreviews.delete(n.id);updateIdeaPreview(n);return;}
 if(e.target.closest('[data-select-idea]')){const index=Number(e.target.closest('[data-select-idea]').dataset.selectIdea),preview=ideaPreviews.get(n.id);preview.ideas[index].selected=!preview.ideas[index].selected;updateIdeaPreview(n);cardEl(n.id)?.querySelector(`[data-select-idea="${index}"]`)?.focus({preventScroll:true});return;}
 if(e.target.closest('[data-edit-idea]')){const preview=ideaPreviews.get(n.id);preview.editing=Number(e.target.closest('[data-edit-idea]').dataset.editIdea);updateIdeaPreview(n);cardEl(n.id)?.querySelector('[data-idea-prompt]')?.focus({preventScroll:true});return;}
 if(e.target.closest('[data-done-idea]')){const preview=ideaPreviews.get(n.id),index=preview.editing;delete preview.editing;updateIdeaPreview(n);cardEl(n.id)?.querySelector(`[data-edit-idea="${index}"]`)?.focus({preventScroll:true});return;}
 if(e.target.closest('[data-launch-ideas]')){launchIdeas(n);return;}
 if(e.target.closest('.open-chat-panel')){openChatPanel(n);return;}
 if(e.target.closest('.note-preview-toggle')){expandedNotes.has(n.id)?expandedNotes.delete(n.id):expandedNotes.add(n.id);refreshCard(n);return;}
 if(e.target.closest('.collapse-card,.chat-preview-toggle')){toggleConversation(n,e);return;}
 const retry=e.target.closest('[data-retry-message]');if(retry&&!generatingChats.has(n.id)){const index=n.messages.findIndex(m=>m.id===retry.dataset.retryMessage);if(index>=0){const failed=n.messages[index];n.draft=failed.retryPrompt;n.messages.splice(index-1,2);send(n);}return;}
 if(e.target.closest('.delete-card'))return deleteNode(n);
 if(e.target.closest('.add-context'))return showContextMenu(n,e.target.closest('.add-context'));
 if(e.target.closest('.add-file')){uploadPoint=freePosition(n.x+(n.width||380)+100,n.y);$('#file-input').click();return}
 const mode=e.target.closest('[data-media-mode]');if(mode){n.searchMode=mode.dataset.mediaMode;mediaErrors.delete(n.id);const previous=mediaRequests.get(n.id);mediaRequests.delete(n.id);previous?.abort();mediaBusy.delete(n.id);refreshCard(n);save();return}

 const result=e.target.closest('[data-media-result]');if(result){if(performance.now()<suppressMediaClickUntil)return;const item=(n.mediaResults||[])[+result.dataset.mediaResult];if(item)addMediaCard(item,n);return}
 const more=e.target.closest('[data-media-more]');if(more){runMediaSearch(n,true);return}
 if(e.target.closest('[data-retry-file]')){fileErrors.delete(n.asset);loadFile(n);return;}
 if(e.target.closest('[data-share-file]')){const button=e.target.closest('button');button.disabled=true;button.textContent='Uploading…';try{const file=await readLocalFile(n.asset);if(!file)throw Error('Reattach this file from the original device.');n.storageId=await window.BoardShared.uploadFile(file);n.revision++;refreshCard(n);record('Enabled file context');notify('File ready. Refresh existing context references to include it.');}catch(error){notify(error.message);refreshCard(n);}return;}
 if(e.target.closest('[data-retry-transcript]')){videoErrors.delete(n.videoId);loadVideoTranscript(n);refreshCard(n);return;}
 if(e.target.closest('[data-play-video]')){playingVideos.add(n.id);refreshCard(n);return;}
 const credit=e.target.closest('[data-media-credit]');if(credit){n.creditOpen=!n.creditOpen;refreshCard(n);return}
 const detachButton=e.target.closest('[data-detach-context]');if(detachButton)return detach(n,detachButton.dataset.detachContext);
 const refresh=e.target.closest('[data-refresh-context]');if(refresh){const c=n.contexts.find(c=>c.id===refresh.dataset.refreshContext),source=nodeById(c?.source);if(source){remember();const savedId=c.id,enabled=c.enabled;Object.assign(c,contextSnapshot(source,c.quote,c.cutoff),{id:savedId,enabled});refreshCard(n);record('Refreshed context snapshot')}return}
 const chip=e.target.closest('[data-context]');if(chip){openContextInspector(n,chip.dataset.context)}
 const branchPoint=e.target.closest('[data-branch-point]');if(branchPoint&&e.detail===0)createBranch(n,'',freePosition(n.x+(n.width||380)+110,n.y+20),branchPoint.dataset.branchPoint);
 const port=e.target.closest('.nib');if(port&&e.detail===0)createBranch(n,'',freePosition(n.x+490,n.y+20));
});
onCardEvent('change',e=>{if(!e.target.matches('[data-toggle-context]'))return;const n=nodeById(e.target.closest('.card').dataset.node),c=n.contexts.find(c=>c.id===e.target.dataset.toggleContext);remember();c.enabled=e.target.checked;refreshCard(n);record('Changed context inclusion')});
onCardEvent('submit',e=>{e.preventDefault();const n=nodeById(e.target.closest('.card').dataset.node);if(e.target.matches('.composer'))return send(n);if(e.target.matches('.search-form')){runMediaSearch(n);return}if(e.target.matches('.url-form'))openURL(e.target.querySelector('[data-url]').value,n)});
onCardEvent('keydown',e=>{if(window.BoardShared?.enabled&&!window.BoardShared.writable)return;
 const n=nodeById(e.target.closest('.card')?.dataset.node);if(!n)return;
 if((e.target.closest('.title-grip')||(camera.z<.25&&e.target.matches('#world .card')))&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();remember();const dx=({ArrowRight:20,ArrowLeft:-20}[e.key]||0),dy=({ArrowDown:20,ArrowUp:-20}[e.key]||0);for(const member of groupMoveMembers(n)){member.x+=dx;member.y+=dy;positionCard(member);}window.BoardShared?.moveNodes?.(groupMoveMembers(n));record('Moved card');requestDraw();return}
 if(e.target.closest('.resize-handle')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();remember();const el=cardEl(n.id);n.width=Math.max(280,Math.min(1200,el.offsetWidth+({ArrowRight:20,ArrowLeft:-20}[e.key]||0)));n.minHeight=Math.max(160,el.offsetHeight+({ArrowDown:20,ArrowUp:-20}[e.key]||0));refreshCard(n);record('Resized card');cardEl(n.id).querySelector('.resize-handle').focus();return}
 if(e.target.matches('[data-prompt]')&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send(n)}
 if(e.target.matches('.card')&&(e.key==='Backspace'||e.key==='Delete')){e.preventDefault();deleteNode(n)}
});
$('#board-title').addEventListener('focus',()=>{editing={field:'title',before:clone(state),value:state.title}});$('#board-title').oninput=()=>{state.title=$('#board-title').innerText};$('#board-title').onblur=commitEdit;$('#board-title').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.target.blur()}};
let createMenuReturnFocus=null;
function closeCreateMenu(restoreFocus=false){
 const menu=$('#create-menu');if(menu.hidden)return;menu.hidden=true;
 if(restoreFocus&&createMenuReturnFocus?.isConnected)createMenuReturnFocus.focus({preventScroll:true});
}
function showCreate(x,y,keyboard=false){
 menuPoint=boardPoint(x,y);const menu=$('#create-menu');createMenuReturnFocus=document.activeElement;
 menu.querySelector('[data-board-action="undo"]').disabled=$('#undo').disabled;
 menu.hidden=false;
 menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,x))+'px';
 menu.style.top=Math.max(73,Math.min(innerHeight-menu.offsetHeight-8,y))+'px';
 menu.querySelector('button:not(:disabled)').focus({preventScroll:true});
}
$('#create-menu').addEventListener('keydown',e=>{
 const buttons=[...$('#create-menu').querySelectorAll('button:not(:disabled)')];const index=buttons.indexOf(document.activeElement);
 if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
  e.preventDefault();e.stopPropagation();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();
 }else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeCreateMenu(true)}
 else if(e.key==='Tab'){closeCreateMenu(true)}
 else if(e.key.length===1&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.stopPropagation()}
});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#create-menu'))closeCreateMenu()},true);
window.addEventListener('resize',()=>closeCreateMenu());
$$('[data-board-action]').forEach(button=>button.onclick=()=>{
 const action=button.dataset.boardAction;closeCreateMenu(true);
 if(action==='undo')undo();if(action==='fit')fit();if(action==='zoom')zoomAt(1/camera.z);
});
$('#board').oncontextmenu=e=>{if(window.BoardShared?.enabled&&!window.BoardShared.writable){e.preventDefault();return;}if(e.target.closest('input,textarea,[contenteditable]'))return;e.preventDefault();cancelGesture();hideSelection();showCreate(e.clientX,e.clientY)};
$$('[data-create]').forEach(b=>b.onclick=()=>{const at=b.closest('#create-menu')?menuPoint:null;$('#create-menu').hidden=true;if(b.dataset.create==='upload'){uploadPoint=at;$('#file-input').click();return}const n=newCard(b.dataset.create,at);const el=cardEl(n.id).querySelector(n.type==='thread'?'[data-prompt]':n.type==='search'?'[data-query]':'[data-edit="title"]');el?.focus({preventScroll:true})});
$('#undo').onclick=()=>undo();$('#fit').onclick=fit;$('#zoomin').onclick=()=>zoomAt(1.15);$('#zoomout').onclick=()=>zoomAt(1/1.15);$('#zoom').onclick=()=>zoomAt(1/camera.z);
const checks=['Can you discover the context nib without instructions?','Does the line make valid connection targets obvious?','Can you branch selected text without losing your selection?','Can you inspect and detach inherited context on the card?','Can you add a context note from a chat?','Does trackpad movement stay under your fingers?','Can you cancel a connection with Escape?','Can you recover the same workspace after reloading?'];
function showHelp(){ $('#test-list').innerHTML=checks.map((c,i)=>`<label><input type="checkbox" data-test="${i}" ${state.tests.includes(i)?'checked':''}>${escapeHTML(c)}</label>`).join('');$('#test-notes').value=state.notes||'';$('#help-dialog').showModal();$$('[data-test]').forEach(c=>c.onchange=()=>{state.tests=c.checked?[...new Set([...state.tests,+c.dataset.test])]:state.tests.filter(i=>i!==+c.dataset.test);save()})}
$('#help').onclick=showHelp;$('#help-dialog .close').onclick=()=>$('#help-dialog').close();$('#test-notes').oninput=e=>{state.notes=e.target.value;save()};$('#reset').onclick=()=>{remember();stopAllSprings();state=initialState();openContexts.clear();camera={x:0,y:0,z:1};render();fit();save();$('#help-dialog').close();notify('Sample workspace restored · undo available')};$('#export').onclick=()=>{commitEdit();const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='branch-session.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
document.addEventListener('keydown',e=>{
 if(document.body.classList.contains('account-mode'))return;
 if(e.key==='Escape'){if(panelNodeId&&!e.target.closest('.idea-preview'))closeChatPanel();for(const key of ideaPreviews.keys()){expandingIdeas.get(key)?.abort();ideaPreviews.delete(key);const node=nodeById(key);if(node){updateIdeaPreview(node);cardEl(key)?.querySelector('[data-expand-idea]')?.focus({preventScroll:true});}}closeContextMenu();if(gesture){cancelGesture();notify('Cancelled')}hideSelection();$('#create-menu').hidden=true;return}
 if($('#help-dialog').open)return;
 if(window.BoardShared?.enabled&&!window.BoardShared.writable)return;
 if(e.altKey&&e.key==='Enter'&&selection){e.preventDefault();const n=nodeById(selection.source);createBranch(n,selection.quote,freePosition(n.x+490,n.y+20));return}
 if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();showCreate(innerWidth/2,innerHeight/2,true);$('#create-menu button').focus();return}
 const typing=e.target.closest('input,textarea,[contenteditable]');if(typing)return;
 if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo(e.shiftKey);return}
 if(e.metaKey||e.ctrlKey||e.altKey)return;
 if(e.key==='?')showHelp();if(e.key.toLowerCase()==='f')fit();const kind={n:'plan',c:'thread',s:'search'}[e.key.toLowerCase()];if(kind){e.preventDefault();if(e.repeat||gesture)return;const n=newCard(kind,boardInsertPoint());animateCardEntrance(n);cardEl(n.id).querySelector(kind==='thread'?'[data-prompt]':kind==='search'?'[data-query]':'[data-edit="title"]')?.focus({preventScroll:true})}
});
window.addEventListener('beforeunload',()=>{if(!document.body.classList.contains('account-mode')){commitEdit();save()}});window.addEventListener('resize',()=>{requestDraw();hideSelection()});
cardObserver=new ResizeObserver(()=>{updateNotePreviews();settleAutomaticNodes();requestDraw()});
render();if(innerWidth<850)camera.x=-50;applyCamera();document.fonts.ready.then(requestDraw);

function syncContextIndicators(sourceId){
 for(const n of state.nodes){
  if(!n.contexts?.some(c=>c.source===sourceId))continue;
  for(const c of n.contexts.filter(c=>c.source===sourceId)){
   const source=nodeById(c.source),chip=cardEl(n.id)?.querySelector(`[data-context="${c.id}"]`);
   if(chip)chip.closest('.context-reference').outerHTML=contextMarkup(c);
  }
  if(n.contexts.some(c=>c.source===sourceId&&openContexts.has(c.id)))refreshCard(n);
 }
}
function updateNotePreviews(){
 $$('.card[data-kind=plan]').forEach(card=>{const body=card.querySelector('.plan-body');card.classList.toggle('long-note',!!body&&body.scrollHeight>240);});
}
function observeCards(){monitorWebsitePreviews();syncAgentStacks();updateNotePreviews();if(!cardObserver)return;cardObserver.disconnect();$$('.card').forEach(el=>cardObserver.observe(el))}
let uploadPoint=null,uploadChat=null;
const fileDatabase=new Promise((resolve,reject)=>{const request=indexedDB.open('branch-files',1);request.onupgradeneeded=()=>request.result.createObjectStore('files');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
fileDatabase.catch(()=>{});
async function storeFile(key,file){const db=await fileDatabase;await new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(file,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
async function readLocalFile(asset){const db=await fileDatabase;return new Promise((resolve,reject)=>{const r=db.transaction('files').objectStore('files').get(asset);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});}
async function loadFile(n){if(loadingFiles.has(n.asset)||assetURLs.has(n.asset))return;loadingFiles.add(n.asset);try{
 const file=await readLocalFile(n.asset);
 if(file)assetURLs.set(n.asset,URL.createObjectURL(file));
 else if(n.storageId&&window.BoardShared?.fileURL)assetURLs.set(n.asset,await window.BoardShared.fileURL(n.storageId));
 else fileErrors.set(n.asset,'This file is on another device. Reattach it from the original device.');
 if(nodeById(n.id))refreshCard(n);
 }catch{fileErrors.set(n.asset,'Could not load this file. Try again.');if(nodeById(n.id))refreshCard(n);}finally{loadingFiles.delete(n.asset);}}
function uploadMarkup(n){const url=assetURLs.get(n.asset),image=/^image\/(png|jpeg|gif|webp|avif)$/.test(n.mime);if(!url&&!fileErrors.has(n.asset))queueMicrotask(()=>loadFile(n));
 return `<div class="card-main file-content">${url&&n.mime==='application/pdf'?`<branch-pdf src="${escapeHTML(url)}" data-key="${escapeHTML(n.asset)}"></branch-pdf>`:url&&image?`<a class="file-image-link" href="${escapeHTML(url)}" target="_blank" rel="noopener" aria-label="View full image"><img class="file-image" src="${escapeHTML(url)}" alt="${escapeHTML(n.title)}"></a>`:n.text?`<div class="file-text">${escapeHTML(n.text)}</div>`:`<div class="file-unavailable">${icon('attachment')}<p>${escapeHTML(fileErrors.get(n.asset)||'Loading file…')}</p>${fileErrors.has(n.asset)?'<button data-retry-file>Retry</button>':''}</div>`}<div class="file-meta"><span>${n.mime==='application/pdf'?'PDF':image?'Image':escapeHTML(n.mime||'File')} · ${n.size>=1048576?(n.size/1048576).toFixed(1)+' MB':Math.round(n.size/1024)+' KB'}</span>${url?`<a href="${escapeHTML(url)}" download="${escapeHTML(n.title)}" aria-label="Download ${escapeHTML(n.title)}" data-tooltip="Download">${icon('attachment')}</a>`:''}</div></div><div class="card-footer"><span>${n.storageId?'Available to board members':n.text?'Text available to chats':'On this device'}</span>${!n.storageId&&url&&!n.text&&window.BoardShared?.writable?'<button data-share-file>Enable chat context</button>':''}</div>`}
$('#file-input').onchange=async e=>{const files=[...e.target.files];e.target.value='';const origin=uploadPoint||boardPoint(innerWidth/2-190,180);const chatId=uploadChat;uploadPoint=null;uploadChat=null;await importFiles(files,origin,chatId)};
async function importFiles(files,origin,chatId=null){let offset=0;for(let file of files){if(!file.type&&/\.pdf$/i.test(file.name))file=new File([file],file.name,{type:'application/pdf'});if(file.size>25*1024*1024){notify('Choose files smaller than 25 MB');continue}try{const asset=id();await storeFile(asset,file);const textType=file.type.startsWith('text/')||/\.(md|txt|csv|json|js|ts|css|html|xml)$/i.test(file.name);const fullText=textType?await file.text():'';if(fullText.length>120000)throw Error('Text files must be under 120,000 characters. Split this file to include all of it.');const text=fullText;const storageId=window.BoardShared?.enabled?await window.BoardShared.uploadFile(file):null;remember();const n={id:id(),type:'upload',title:file.name,...(offset?freePosition(origin.x+offset,origin.y,380):origin),asset,...(storageId?{storageId}:{}),mime:file.type,size:file.size,text,revision:1};assetURLs.set(asset,URL.createObjectURL(file));state.nodes.push(n);refreshCard(n);if(chatId)connectContextNode(n,nodeById(chatId));record('Uploaded local file');showFirstUse(file.type.startsWith('image/')?'image':'file');offset+=420}catch(error){notify(error.message||'Could not save this file')}}}
state.nodes.filter(n=>n.type==='upload').forEach(loadFile);

function updateBranchGhost(g,x,y,target){$('#branch-ghost').hidden=true;g.previewPoint=null;}

function messageHTML(text){
 // A missing renderer must not abort loading the rest of a shared board.
 if(typeof window.BranchMarkdown==='function'){
  try{return window.BranchMarkdown(text);}catch(error){console.warn('Message formatting unavailable',error);}
 }
 return escapeHTML(text).replace(/\r\n?|\n/g,'<br>');
}

function searchMarkup(n){const mode=n.searchMode||'images',busy=mediaBusy.has(n.id),results=n.resultMode===mode?n.mediaResults||[]:[],error=mediaErrors.get(n.id);return `<div class="media-search"><div class="media-search-head"><div class="media-tabs" role="tablist" aria-label="Search media"><button data-media-mode="images" role="tab" aria-label="Image search" aria-selected="${mode==='images'}" title="Images">${icon('media-image')}</button><button data-media-mode="video" role="tab" aria-label="YouTube link" aria-selected="${mode==='video'}" title="YouTube">${icon('youtube')}</button></div></div><form class="search-form"><div class="media-query">${icon(mode==='images'?'search':'link')}<input data-query aria-label="${mode==='images'?'Image search query':'YouTube video link'}" placeholder="${mode==='images'?'Search images':'Paste a YouTube link'}" value="${escapeHTML(n.query||'')}"><button aria-label="${mode==='images'?'Search':'Preview video'}" title="${mode==='images'?'Search':'Preview video'}" ${busy?'disabled':''}>${icon(busy?'refresh':'arrow-up')}</button></div></form>${error?`<p class="search-status" role="status">${escapeHTML(error)}</p>`:''}${busy?`<div class="search-loading" aria-label="Searching">${icon('refresh')}</div>`:''}<div class="media-results">${results.map((r,i)=>`<button class="media-result ${r.type==='video'?'video-result':''}" data-media-result="${i}" title="${escapeHTML(r.title)}" aria-label="Add ${escapeHTML(r.title)} to board"><span class="thumbnail"><img draggable="false" loading="lazy" src="${escapeHTML(r.thumb)}" alt="">${r.type==='video'?`<span class="play-indicator">${icon('play')}</span>`:''}</span><span class="result-title">${escapeHTML(r.title)}</span></button>`).join('')}</div>${results.length&&mode==='images'?`<div class="result-footer"><a href="https://commons.wikimedia.org/" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>${n.nextPage?`<button data-media-more aria-label="More results" title="More results" ${busy?'disabled':''}>${icon('plus')}</button>`:''}</div>`:''}</div>`}

function mediaMarkup(n){const video=n.mediaType==='video';if(video)return youtubeMarkup(n);return `<div class="media-content">${video?`<iframe class="video-player" title="${escapeHTML(n.title)}" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(n.videoId)}?rel=0&origin=${encodeURIComponent(location.origin)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`:`<img class="source-image" src="${escapeHTML(n.image)}" alt="${escapeHTML(n.title)}">`}<div class="media-credit-bar"><span>${escapeHTML(video?'YouTube':n.credit||'Wikimedia Commons')}</span><button data-media-credit aria-label="Source details" title="Source details">${icon('info-circle')}</button><a href="${escapeHTML(n.source)}" target="_blank" rel="noopener noreferrer" aria-label="Open original source" title="Open original">${icon('arrow-up-right')}</a></div>${n.creditOpen?`<div class="source-credit">${escapeHTML(n.title)}${n.license?`<br>${escapeHTML(n.license)}`:''}${n.licenseURL?` · <a href="${escapeHTML(n.licenseURL)}" target="_blank" rel="noopener noreferrer">License</a>`:''}</div>`:''}</div>`}
function plainMetadata(value){const text=document.createElement('textarea');text.innerHTML=String(value||'').replace(/<[^>]*>/g,'');return text.value}
async function runMediaSearch(n,more=false){const query=n.query?.trim(),mode=n.searchMode||'images';if(!query)return;if(mode==='video'){const vid=BranchMedia.videoId(query);if(!vid){mediaErrors.set(n.id,'Paste a valid YouTube video link.');refreshCard(n);return;}mediaErrors.delete(n.id);n.mediaResults=[{type:'video',id:vid,title:'YouTube video',thumb:'https://i.ytimg.com/vi/'+vid+'/hqdefault.jpg',source:'https://www.youtube.com/watch?v='+vid}];n.resultMode='video';n.nextPage=null;save();refreshCard(n);return;}mediaRequests.get(n.id)?.abort();const controller=new AbortController();mediaRequests.set(n.id,controller);mediaBusy.add(n.id);mediaErrors.delete(n.id);refreshCard(n);const timer=setTimeout(()=>controller.abort(),15000);try{let results,nextPage;
 if(mode==='images'){
  const params=new URLSearchParams({action:'query',generator:'search',gsrsearch:query+' filetype:bitmap',gsrnamespace:'6',gsrlimit:'12',prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'640',format:'json',origin:'*'});if(more&&n.nextPage)params.set('gsroffset',String(n.nextPage));
  const response=await fetch('https://commons.wikimedia.org/w/api.php?'+params,{signal:controller.signal});if(!response.ok)throw Error(response.status===429?'Image search is busy. Try again shortly.':'Image search could not load.');const data=await response.json();if(data.error)throw Error('Image search could not load.');results=Object.values(data.query?.pages||{}).sort((a,b)=>(a.index||0)-(b.index||0)).flatMap(p=>{const info=p.imageinfo?.[0];if(!info?.thumburl||!BranchMedia.httpsURL(info.thumburl))return[];const meta=info.extmetadata||{};return[{type:'image',id:String(p.pageid),title:p.title.replace(/^File:/,''),thumb:info.thumburl,image:info.thumburl,source:BranchMedia.httpsURL(info.descriptionurl)||'https://commons.wikimedia.org/wiki/'+encodeURIComponent(p.title),credit:plainMetadata(meta.Artist?.value).slice(0,200),license:plainMetadata(meta.LicenseShortName?.value),licenseURL:BranchMedia.httpsURL(meta.LicenseUrl?.value)}]});nextPage=data.continue?.gsroffset||null;
 }
 if(mediaRequests.get(n.id)!==controller||nodeById(n.id)!==n)return;n.mediaResults=more?[...(n.mediaResults||[]),...results]:results;n.resultMode=mode;n.nextPage=nextPage;if(!results.length&&!more)mediaErrors.set(n.id,'No results.');save();
 }catch(error){if(mediaRequests.get(n.id)===controller&&nodeById(n.id)===n)mediaErrors.set(n.id,error.name==='AbortError'?'Search timed out. Try again.':error.message==='Failed to fetch'?'Could not reach search. Check your connection.':error.message)}finally{clearTimeout(timer);if(mediaRequests.get(n.id)===controller){mediaBusy.delete(n.id);mediaRequests.delete(n.id);if(nodeById(n.id)===n)refreshCard(n)}}}
function addMediaCard(item,source,position){remember();const p=position||freePosition(source.x+(source.width||380)+90,source.y);const n={id:id(),type:'media',mediaType:item.type,title:item.title,x:p.x,y:p.y,width:item.type==='video'?520:380,revision:1,source:item.source,credit:item.credit||'',license:item.license||'',licenseURL:item.licenseURL||'',videoId:item.type==='video'?item.id:null,image:item.image||item.thumb};state.nodes.push(n);refreshCard(n);record('Added media source');showFirstUse(item.type==='video'?'video':'image');}

function syncNib(n){const el=cardEl(n.id);if(!el)return;const expand=el.querySelector('[data-expand-idea]');if(BranchContext.hasContent(n)){if(!expand)el.querySelector('.header-actions')?.insertAdjacentHTML('afterbegin',expandIdeaButton(n));}else expand?.remove();const nib=el.querySelector('.nib');if(BranchContext.hasContent(n)){if(!nib)el.insertAdjacentHTML('beforeend',nibMarkup(n));}else nib?.remove();}
function updateLinkGhost(g,x,y){
 let ghost=$('#link-ghost');
 if(!ghost){
  ghost=document.createElement('div');ghost.id='link-ghost';ghost.setAttribute('aria-hidden','true');
  ghost.textContent=g.kind==='excerpt'?g.quote:g.link.textContent||new URL(g.url).hostname;
  ghost.classList.toggle('excerpt-ghost',g.kind==='excerpt');
  ghost.style.width=Math.max(32,g.boxWidth)+'px';ghost.style.height=Math.max(22,g.boxHeight)+'px';
  $('#world').append(ghost);document.body.classList.add('dragging-link');
  startWire(g.source,g.sx,g.sy,true,null,g.quote||'');
  const fallback=wire.start;if(g.kind==='link')wire.start=()=>{const r=previewLinkRect(g.link);return r?{x:r.right+3*camera.z,y:r.top+r.height/2-boardTop()}:fallback();};
 }
 const at=boardPoint(x,y);g.previewPoint={x:at.x-g.offsetX,y:at.y-g.offsetY};
 ghost.style.transform=`translate3d(${g.previewPoint.x}px,${g.previewPoint.y}px,0)`;
 clearTargets();const target=g.kind==='excerpt'?findTarget(g,x,y):null;g.target=target?.id;if(target)cardEl(target.id).classList.add('target');
 ghost.classList.toggle('invalid',!target&&!validMediaDrop(x,y));
 wire.target=screenPoint(g.previewPoint.x,g.previewPoint.y+Math.max(22,g.boxHeight)/2);if(target)wire.target=portPoint(target,true);wire.magnet=!!target;wire.bend=0;requestDraw();
}
function validMediaDrop(x,y){return y>75&&y<innerHeight-75&&!document.elementFromPoint(x,y)?.closest('.card,header,nav,footer');}
function updateMediaGhost(g,x,y){let ghost=$('#media-ghost');if(!ghost){ghost=document.createElement('div');ghost.id='media-ghost';ghost.setAttribute('aria-hidden','true');const item=g.item;ghost.innerHTML=`<span class="ghost-label">${escapeHTML(item.title)}</span><img src="${escapeHTML(item.image||item.thumb)}" alt="">${item.type==='video'?`<span class="play-indicator">${icon('play')}</span>`:''}<span class="context-pill"></span>`;ghost.style.width=(item.type==='video'?520:380)+'px';$('#world').append(ghost);}const at=boardPoint(x,y);g.previewPoint={x:at.x-g.offsetX,y:at.y-g.offsetY};ghost.style.transform=`translate3d(${g.previewPoint.x}px,${g.previewPoint.y}px,0)`;ghost.classList.toggle('invalid',!validMediaDrop(x,y));}
onCardEvent('paste',e=>{const input=e.target.closest('[data-query]');if(!input)return;const n=nodeById(input.closest('.card').dataset.node);if(n.searchMode!=='video')return;const value=e.clipboardData?.getData('text/plain')?.trim();if(!BranchMedia.videoId(value))return;e.preventDefault();n.query=value;runMediaSearch(n);});

let boardPointer=null;
$('#board').addEventListener('pointermove',e=>{boardPointer={x:e.clientX,y:e.clientY};});
function boardInsertPoint(){return boardPointer?boardPoint(boardPointer.x,boardPointer.y):boardPoint(innerWidth/2-190,Math.max(150,innerHeight/2-100));}
function animateCardEntrance(node){
 const card=cardEl(node.id);if(reduced.matches||!card?.animate)return;
 // Keep the world position fixed; grabbing the card cancels entry immediately.
 const animation=card.animate([{opacity:0,transform:`translate3d(${node.x}px,${node.y}px,0) scale(.96)`,transformOrigin:'top left'},{opacity:1,transform:`translate3d(${node.x}px,${node.y}px,0) scale(1)`,transformOrigin:'top left'}],{duration:180,easing:'cubic-bezier(.23,1,.32,1)',id:'card-entrance'});
 const cancel=()=>animation.cancel();card.addEventListener('pointerdown',cancel,{once:true});
 animation.finished?.catch(()=>{}).finally(()=>card.removeEventListener('pointerdown',cancel));
}
function editableTarget(target){return !!target.closest('input,textarea,[contenteditable="true"],[contenteditable="plaintext-only"]');}
function insertVideoLink(raw,point){const vid=BranchMedia.videoId(raw);if(!vid)return false;addMediaCard({type:'video',id:vid,title:'YouTube video',source:'https://www.youtube.com/watch?v='+vid},null,point);showFirstUse('video');return true;}
document.addEventListener('paste',e=>{if(document.body.classList.contains('account-mode')||(window.BoardShared?.enabled&&!window.BoardShared.writable))return;if(e.defaultPrevented||editableTarget(e.target)||e.target.closest('dialog'))return;const images=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));if(images.length){e.preventDefault();importFiles(images,boardInsertPoint());return;}const raw=e.clipboardData?.getData('text/plain')?.trim();if(!raw)return;e.preventDefault();if(BranchMedia.videoId(raw)){insertVideoLink(raw,boardInsertPoint());return;}let url;try{url=new URL(raw);}catch{}if(url&&['https:','http:'].includes(url.protocol)){remember();const p=boardInsertPoint(),n={id:id(),type:'web',title:url.hostname,url:url.href,x:p.x,y:p.y,width:440,revision:1};state.nodes.push(n);refreshCard(n);record('Pasted website');showFirstUse('website');}else{const n=newCard('plan',boardInsertPoint());n.body=raw;n.title='Note';refreshCard(n);save();}});
$('#board').addEventListener('dragover',e=>{if(gesture||editableTarget(e.target))return;if([...e.dataTransfer.types].some(t=>['Files','text/plain','text/uri-list','application/x-branch-github'].includes(t))){e.preventDefault();e.dataTransfer.dropEffect='copy';$('#board').classList.add('file-drop-active');}});
$('#board').addEventListener('dragleave',e=>{if(!$('#board').contains(e.relatedTarget))$('#board').classList.remove('file-drop-active');});
$('#board').addEventListener('drop',e=>{if(window.BoardShared?.enabled&&!window.BoardShared.writable)return;$('#board').classList.remove('file-drop-active');if(gesture||editableTarget(e.target))return;e.preventDefault();const point=boardPoint(e.clientX,e.clientY),files=[...e.dataTransfer.files];const githubItem=e.dataTransfer.getData('application/x-branch-github');if(githubItem){try{window.BranchGitHub?.drop(JSON.parse(githubItem),point);}catch{}return;}if(files.length){importFiles(files,point);return;}insertVideoLink(e.dataTransfer.getData('text/uri-list')||e.dataTransfer.getData('text/plain'),point);});

function addContextNode(chat){const note=newCard('plan',freePosition(chat.x-440,chat.y,380));note.title='Context';note.contextFor=chat.id;chat.contexts.push(contextSnapshot(note));refreshCard(note);refreshCard(chat);const rect=cardEl(note.id).getBoundingClientRect();if(rect.left<20)camera.x+=20-rect.left;else if(rect.right>innerWidth-20)camera.x-=rect.right-innerWidth+20;if(rect.top<115)camera.y+=115-rect.top;else if(rect.bottom>innerHeight-90)camera.y-=Math.min(rect.top-115,rect.bottom-innerHeight+90);applyCamera();save();cardEl(note.id).querySelector('.plan-body').focus({preventScroll:true});}
function syncDraftContext(note){if(!note.contextFor)return;const chat=nodeById(note.contextFor),binding=chat?.contexts?.find(c=>c.source===note.id);if(!binding)return;const bindingId=binding.id,enabled=binding.enabled;Object.assign(binding,contextSnapshot(note),{id:bindingId,enabled});chat.revision++;refreshCard(chat);}
// Move only the visible capsule; its hitbox stays stationary and reliable.
let hoveredMoveGrip=null;
function resetMoveGrip(){hoveredMoveGrip?.querySelector('.grip-dots')?.style.removeProperty('transform');hoveredMoveGrip=null;}
function followMoveGrip(e){
 if(gesture)return;
 const grip=e.target.closest?.('#cards .card>.title-grip');
 if(hoveredMoveGrip!==grip)resetMoveGrip();
 if(!grip||e.pointerType==='touch'||reduced.matches)return;
 const rect=grip.getBoundingClientRect();
 if(!rect.width||!rect.height)return;
 if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom){resetMoveGrip();return;}
 hoveredMoveGrip=grip;
 const x=(e.clientX-rect.left-rect.width/2)/camera.z,y=(e.clientY-rect.top-rect.height/2)/camera.z;
 grip.querySelector('.grip-dots').style.transform=`translate3d(${x}px,${y}px,0)`;
}
document.addEventListener('pointerover',followMoveGrip);
document.addEventListener('pointermove',followMoveGrip);
document.addEventListener('pointerup',followMoveGrip);
document.addEventListener('pointerout',e=>{if(!gesture&&hoveredMoveGrip&&!hoveredMoveGrip.contains(e.relatedTarget))resetMoveGrip();});
document.addEventListener('pointercancel',resetMoveGrip);
window.addEventListener('blur',resetMoveGrip);
reduced.addEventListener('change',resetMoveGrip);
const branchHint=document.createElement('div');branchHint.id='branch-hint';branchHint.textContent='Create branch';branchHint.hidden=true;branchHint.setAttribute('aria-hidden','true');document.body.append(branchHint);
document.addEventListener('pointermove',e=>{const nib=e.target.closest('.nib,[data-branch-point],[data-context-port]');branchHint.hidden=!nib||!!gesture;if(!branchHint.hidden){branchHint.style.left=Math.min(innerWidth-110,e.clientX+15)+'px';branchHint.style.top=Math.min(innerHeight-35,e.clientY+18)+'px';}const selected=getSelection();$$('.selection-draggable').forEach(el=>el.classList.remove('selection-draggable'));if(!gesture&&selection&&selected.rangeCount){const inside=[...selected.getRangeAt(0).getClientRects()].some(r=>e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom);if(inside)e.target.closest('p,li,pre,[contenteditable],[data-message-text],.file-text')?.classList.add('selection-draggable');}});
document.addEventListener('pointerdown',()=>{branchHint.hidden=true;});
window.addEventListener('blur',()=>{branchHint.hidden=true;});

function branchContextBinding(g,target,point){if(target)remember();else target=newCard('thread',point);const binding={...clone(g.binding),id:id(),originNode:g.originNode,originContext:g.originContext};target.contexts.push(binding);if(target.title==='New conversation')target.title='Explore '+binding.title;target.revision++;refreshCard(target);record('Branched context item');}
function connectContextNode(source,chat){if(!chat)return;chat.contexts.push(contextSnapshot(source));chat.revision++;refreshCard(chat);}
let contextMenuChat=null,contextMenuTrigger=null;
const contextMenu=document.createElement('div');contextMenu.id='context-menu';contextMenu.hidden=true;contextMenu.setAttribute('role','menu');contextMenu.setAttribute('aria-label','Add context');contextMenu.innerHTML=[['note','page','Context note'],['file','attachment','Upload file'],['link','link','Paste link']].map(([kind,symbol,label],i)=>`<button type="button" role="menuitem" data-context-kind="${kind}" aria-label="${label}" data-tooltip="${label}" style="--dx:${[-42,0,42][i]}px;--dy:${[-18,-53,-18][i]}px">${icon(symbol)}</button>`).join('');document.body.append(contextMenu);
function closeContextMenu(){contextMenu.hidden=true;contextMenuChat=null;contextMenuTrigger?.setAttribute('aria-expanded','false');contextMenuTrigger=null;}
function showContextMenu(chat,button){if(!contextMenu.hidden&&contextMenuTrigger===button){closeContextMenu();return;}closeContextMenu();const r=button.getBoundingClientRect();contextMenuTrigger=button;button.setAttribute('aria-expanded','true');contextMenuChat=chat.id;contextMenu.style.left=Math.max(72,Math.min(innerWidth-72,r.left+r.width/2))+'px';contextMenu.style.top=Math.max(145,r.top+r.height/2)+'px';contextMenu.hidden=false;}
contextMenu.addEventListener('click',e=>{const kind=e.target.closest('[data-context-kind]')?.dataset.contextKind,chat=nodeById(contextMenuChat);if(!kind||!chat)return;closeContextMenu();if(kind==='note')addContextNode(chat);else if(kind==='file'){uploadChat=chat.id;uploadPoint=freePosition(chat.x-440,chat.y,380);$('#file-input').click();}else showContextLink(chat);});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#context-menu,.add-context'))closeContextMenu();},true);
document.addEventListener('focusin',e=>{if(!e.target.closest('#context-menu,.add-context'))closeContextMenu();});
contextMenu.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();const trigger=contextMenuTrigger;closeContextMenu();trigger?.focus({preventScroll:true});}});
const contextLink=document.createElement('form');contextLink.id='context-link';contextLink.hidden=true;contextLink.innerHTML=`${icon('link')}<input type="url" required aria-label="Context website or video URL" placeholder="Paste a website or video link"><button aria-label="Add link context">${icon('arrow-up')}</button><button type="button" aria-label="Cancel link">${icon('xmark')}</button>`;document.body.append(contextLink);
let contextLinkChat=null;
function showContextLink(chat){contextLinkChat=chat.id;const r=cardEl(chat.id).getBoundingClientRect();contextLink.style.left=Math.max(12,Math.min(innerWidth-360,r.left))+'px';contextLink.style.top=Math.max(80,Math.min(innerHeight-80,r.bottom-60))+'px';contextLink.hidden=false;contextLink.querySelector('input').value='';contextLink.querySelector('input').focus();}
contextLink.querySelector('[type=button]').onclick=()=>{contextLink.hidden=true;};
contextLink.addEventListener('keydown',e=>{if(e.key==='Escape'){contextLink.hidden=true;e.stopPropagation();}});
contextLink.onsubmit=e=>{e.preventDefault();const raw=contextLink.querySelector('input').value.trim(),chat=nodeById(contextLinkChat);let url;try{url=new URL(raw);if(!['https:','http:'].includes(url.protocol))throw Error();}catch{return notify('Use an http or https link');}if(!chat)return;remember();const point=freePosition(chat.x-440,chat.y,380),vid=BranchMedia.videoId(raw);const n={id:id(),type:vid?'media':'web',title:vid?'YouTube video':url.hostname.replace(/^www\./,''),x:point.x,y:point.y,width:vid?520:440,revision:1,...(vid?{mediaType:'video',videoId:vid,source:url.href}:{url:url.href})};state.nodes.push(n);refreshCard(n);connectContextNode(n,chat);record('Added link context');contextLink.hidden=true;};

function quotePortPoint(node,quote){if(node.id===panelNodeId)return null;if(!quote)return null;for(const content of cardEl(node.id)?.querySelectorAll('.plan-body,.website-notes,[data-message-text],.file-text')||[]){const at=content.textContent.indexOf(quote);if(at<0)continue;const walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);let leaf,offset=0,start=null,end=null;while(leaf=walker.nextNode()){const next=offset+leaf.textContent.length;if(!start&&at<next)start={node:leaf,offset:at-offset};if(at+quote.length<=next){end={node:leaf,offset:at+quote.length-offset};break;}offset=next;}if(!start||!end)continue;const range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);const rects=[...range.getClientRects()].filter(r=>r.width&&r.height);const r=rects[rects.length-1];if(r)return{x:r.right,y:r.top+r.height/2-boardTop()};}return null;}

function clearRoundedSelection(doc=document){doc.querySelectorAll('.rounded-selection').forEach(el=>el.classList.remove('rounded-selection'));doc.getElementById('selection-highlight')?.remove();}
function selectionBlobs(rects){
 const rows=[];
 for(const r of [...rects].filter(r=>r.width&&r.height).sort((a,b)=>a.top-b.top||a.left-b.left)){
  const row=rows.find(row=>Math.abs(row.top-r.top)<Math.min(row.bottom-row.top,r.height)*.5);
  if(row){row.left=Math.min(row.left,r.left);row.right=Math.max(row.right,r.right);row.top=Math.min(row.top,r.top);row.bottom=Math.max(row.bottom,r.bottom);}
  else rows.push({left:r.left,right:r.right,top:r.top,bottom:r.bottom});
 }
 // Shared horizontal seams make wrapped lines a single silhouette, including line-height gaps.
 return rows.map((row,i)=>({left:row.left-3,right:row.right+3,top:i?(rows[i-1].bottom+row.top)/2:row.top-2,bottom:i<rows.length-1?(row.bottom+rows[i+1].top)/2:row.bottom+2}));
}
function selectionOutline(rows){
 if(!rows.length)return '';
 const bands=[];
 for(let i=0;i<rows.length;i++){
  const row={...rows[i]},next=rows[i+1];
  if(next&&Math.min(row.right,next.right)<=Math.max(row.left,next.left)){
   const seam=row.bottom;row.bottom-=2;bands.push(row,{left:Math.min(row.left,next.left),right:Math.max(row.right,next.right),top:seam-2,bottom:seam+2});
   rows[i+1]={...next,top:seam+2};
  }else bands.push(row);
 }
 const points=[];
 for(const row of bands)points.push([row.right,row.top],[row.right,row.bottom]);
 for(const row of [...bands].reverse())points.push([row.left,row.bottom],[row.left,row.top]);
 const clean=points.filter((p,i)=>!i||p[0]!==points[i-1][0]||p[1]!==points[i-1][1]);
 // Round the perimeter itself, rather than rounding every line independently.
 return clean.map((p,i)=>{
  const prev=clean[(i+clean.length-1)%clean.length],next=clean[(i+1)%clean.length];
  const before=Math.hypot(p[0]-prev[0],p[1]-prev[1]),after=Math.hypot(next[0]-p[0],next[1]-p[1]),r=Math.min(6,before/2,after/2);
  const a=[p[0]+(prev[0]-p[0])*r/before,p[1]+(prev[1]-p[1])*r/before],b=[p[0]+(next[0]-p[0])*r/after,p[1]+(next[1]-p[1])*r/after];
  return `${i?'L':'M'}${a} Q${p} ${b}`;
 }).join(' ')+' Z';
}
function paintRoundedSelection(content,rects){
 const doc=content.ownerDocument;clearRoundedSelection(doc);if(!rects.length)return;content.classList.add('rounded-selection');
 const layer=doc.createElementNS('http://www.w3.org/2000/svg','svg');layer.id='selection-highlight';layer.setAttribute('aria-hidden','true');
 const path=doc.createElementNS(layer.namespaceURI,'path');path.setAttribute('d',selectionOutline(selectionBlobs(rects)));layer.append(path);doc.body.append(layer);
}
function selectionContent(node){return (node?.nodeType===1?node:node?.parentElement)?.closest('.card');}
function wordAtPoint(doc,x,y,container){
 const caret=doc.caretPositionFromPoint?.(x,y),range=caret?null:doc.caretRangeFromPoint?.(x,y);
 const node=caret?.offsetNode||range?.startContainer,offset=caret?.offset??range?.startOffset;
 if(!node||node.nodeType!==3||!container.contains(node))return null;
 const root=node.parentElement.closest('p,li,pre,blockquote,h1,h2,h3,h4,h5,h6,td,th,div')||container;
 const walker=doc.createTreeWalker(root,4),leaves=[];let leaf,text='',at=0;
 while(leaf=walker.nextNode()){if(leaf===node)at=text.length+offset;leaves.push({node:leaf,start:text.length});text+=leaf.data;}
 const words=[...new Intl.Segmenter(undefined,{granularity:'word'}).segment(text)].filter(s=>s.isWordLike);
 const word=words.find(s=>at>=s.index&&at<s.index+s.segment.length)||words.find(s=>at===s.index+s.segment.length);
 if(!word)return null;
 const point=index=>{const item=leaves.find(l=>index>=l.start&&index<=l.start+l.node.length)||leaves.at(-1);return [item.node,index-item.start];};
 const result=doc.createRange();result.setStart(...point(word.index));result.setEnd(...point(word.index+word.segment.length));return result;
}
function installWordSelection(doc=document){
 let drag=null,suppressClick=false;
 const win=doc.defaultView;
 const contentFor=node=>doc===document?selectionContent(node):doc.body;
 doc.addEventListener('pointerdown',e=>{
  drag=null;if(e.button!==0||e.detail>=2||e.isPrimary===false||e.pointerType==='touch'||e.shiftKey||e.metaKey||e.ctrlKey||e.altKey)return;
  if(e.target.closest('button,a,input,textarea,select,.title-grip,.resize-handle,.nib,[data-branch-point]'))return;
  const content=contentFor(e.target);if(!content)return;
  const selected=win.getSelection();
  // An existing selection keeps its direct manipulation / excerpt drag behavior.
  if(doc===document&&selection&&selected.rangeCount&&[...selected.getRangeAt(0).getClientRects()].some(r=>e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom))return;
  const word=wordAtPoint(doc,e.clientX,e.clientY,content);if(word)drag={pointer:e.pointerId,content,word,x:e.clientX,y:e.clientY,active:false,target:e.target};
 },true);
 // Own the mouse selection so the browser's subsequent mousemove cannot restore partial words.
 // Keep a normal caret for a click in editable text; snapping starts once the pointer moves.
 doc.addEventListener('mousedown',e=>{
  if(!drag||gesture)return;e.preventDefault();
  e.target.closest('[contenteditable]')?.focus({preventScroll:true});
  const caret=doc.caretPositionFromPoint?.(e.clientX,e.clientY),range=caret?null:doc.caretRangeFromPoint?.(e.clientX,e.clientY);
  if(caret)win.getSelection().collapse(caret.offsetNode,caret.offset);
  else if(range)win.getSelection().collapse(range.startContainer,range.startOffset);
 },true);
 doc.addEventListener('keydown',e=>{if(e.key==='Escape')drag=null;},true);
 doc.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.pointer||gesture)return;
  if(!drag.active&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<3)return;
  const word=wordAtPoint(doc,e.clientX,e.clientY,drag.content);if(!word)return;
  e.preventDefault();drag.active=true;
  const backward=word.compareBoundaryPoints(0,drag.word)<0,selected=win.getSelection();
  selected.setBaseAndExtent(backward?drag.word.endContainer:drag.word.startContainer,backward?drag.word.endOffset:drag.word.startOffset,backward?word.startContainer:word.endContainer,backward?word.startOffset:word.endOffset);
  if(doc===document)updateSelectionHandle();else paintRoundedSelection(drag.content,[...selected.getRangeAt(0).getClientRects()]);
 },true);
 doc.addEventListener('pointerup',e=>{if(drag&&e.pointerId===drag.pointer){suppressClick=drag.active;drag=null;}},true);
 doc.addEventListener('pointercancel',()=>{drag=null;});win.addEventListener('blur',()=>{drag=null;});
 doc.addEventListener('click',e=>{if(suppressClick){suppressClick=false;e.preventDefault();e.stopPropagation();}},true);
 if(doc!==document){
  const style=doc.createElement('style');style.textContent='.rounded-selection::selection,.rounded-selection *::selection{background:transparent;color:inherit}#selection-highlight{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;mix-blend-mode:multiply;opacity:.4}#selection-highlight path{fill:#a9c8fb}';doc.head.append(style);
  const repaint=()=>{const selected=win.getSelection();if(!selected.rangeCount||selected.isCollapsed)clearRoundedSelection(doc);else paintRoundedSelection(doc.body,[...selected.getRangeAt(0).getClientRects()]);};
  doc.addEventListener('selectionchange',repaint);doc.addEventListener('scroll',repaint,true);win.addEventListener('resize',repaint);
 }
}
installWordSelection();
// Install only where browser access is allowed. Never weaken an embed's sandbox.
const selectionFrameDocuments=new WeakSet();
document.addEventListener('load',e=>{if(e.target.tagName!=='IFRAME')return;try{const doc=e.target.contentDocument;if(doc?.body&&!selectionFrameDocuments.has(doc)){selectionFrameDocuments.add(doc);installWordSelection(doc);}}catch{}},true);


async function fetchVideoTranscript(videoId){
 if(videoResults.has(videoId))return videoResults.get(videoId);
 if(videoRequests.has(videoId))return videoRequests.get(videoId);
 const request=(async()=>{const response=await fetch('/api/transcript',{method:'POST',headers:{'Content-Type':'application/json',...window.BoardShared?.headers()},body:JSON.stringify({videoId}),signal:AbortSignal.timeout(35000)});const data=await response.json();if(!response.ok)throw Error(data.error||'Could not load captions.');videoResults.set(videoId,data);videoErrors.delete(videoId);return data;})();
 videoRequests.set(videoId,request);try{return await request;}finally{videoRequests.delete(videoId);}
}
async function loadVideoTranscript(n){
 const videoId=n.videoId;if(n.transcript||videoRequests.has(videoId))return;
 try{const data=await fetchVideoTranscript(videoId),current=nodeById(n.id);if(!current||current.videoId!==videoId)return;
 current.transcript=data.text;current.transcriptLanguage=data.language;current.revision=(current.revision||1)+1;
 if(!current.titleEdited&&current.title==='YouTube video'&&data.title){current.title=data.title;current.titleGenerated=true;}
 refreshCard(current);syncContextIndicators(current.id);save();
 }catch(error){videoErrors.set(videoId,error.name==='TimeoutError'?'Caption retrieval timed out. Try again.':error.message);const current=nodeById(n.id);if(current?.videoId===videoId)refreshCard(current);}
}
async function prepareVideoTranscripts(bindings){
 const ids=BranchVideoContext.pendingVideoIds(bindings);if(ids.length>8)throw Error('Connect up to eight videos per message.');const results=[];
 for(const videoId of ids){try{const data=await fetchVideoTranscript(videoId);results.push({id:data.id,text:data.text,language:data.language});}catch(error){throw Error('Video captions could not be loaded: '+error.message+' Retry captions on the video card, or detach it before sending.');}}
 return results;
}
function youtubeMarkup(n){const playing=playingVideos.has(n.id);if(!n.transcript&&!videoErrors.has(n.videoId)&&!videoRequests.has(n.videoId)&&window.BoardShared?.writable)queueMicrotask(()=>loadVideoTranscript(n));return `<div class="youtube-content"><div class="youtube-screen">${playing?`<iframe class="video-player" title="${escapeHTML(n.title)}" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(n.videoId)}?autoplay=1&rel=0&origin=${encodeURIComponent(location.origin)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`:`<button class="youtube-poster" data-play-video aria-label="Play ${escapeHTML(n.title)}"><img src="https://i.ytimg.com/vi/${encodeURIComponent(n.videoId)}/hqdefault.jpg" alt="" draggable="false"><span class="youtube-play">${icon('play')}</span><span class="youtube-caption">${escapeHTML(n.title)}</span></button>`}</div><div class="youtube-footer"><span>YouTube · ${n.transcript?'Transcript ready · '+escapeHTML(n.transcriptLanguage||'captions'):videoErrors.has(n.videoId)?'Captions unavailable':'Loading transcript…'}</span><a href="${escapeHTML(n.source)}" target="_blank" rel="noopener noreferrer" aria-label="Open video on YouTube" title="Open on YouTube">${icon('link')}</a></div>${n.transcript?`<button type="button" class="video-transcript-button" data-source-info aria-label="Read video transcript">${icon('page')} Read transcript</button>`:videoErrors.has(n.videoId)?`<div class="video-transcript-error" role="status"><span>${escapeHTML(videoErrors.get(n.videoId))}</span><button type="button" data-retry-transcript>Retry captions</button></div>`:''}</div>`;}

function syncConnectedNibs(){
 const used=new Set();
 for(const node of state.nodes){for(const context of node.contexts||[]){
  const target=cardEl(node.id)?.querySelector(`[data-context-port="${context.id}"]`);if(target)used.add(target);
  const origin=context.cutoff?cardEl(context.source)?.querySelector(`[data-branch-point="${context.cutoff}"]`):cardEl(context.source)?.querySelector(':scope > .nib');
  if(origin)used.add(origin);
 }}
 if(gesture?.kind==='context'){
  const active=gesture.originNode?cardEl(gesture.originNode)?.querySelector(`[data-context-port="${gesture.originContext}"]`):gesture.cutoff?cardEl(gesture.source)?.querySelector(`[data-branch-point="${gesture.cutoff}"]`):cardEl(gesture.source)?.querySelector(':scope > .nib');
  if(active)used.add(active);
 }
 document.querySelectorAll('.nib,.message-branch,.context-output').forEach(el=>el.classList.toggle('connected-nib',used.has(el)));
}


function scheduleNodeTitle(n){if(window.BoardShared?.applying)return;if(n.titleEdited||n.titleGenerated||titleRequests.has(n.id)||n.type==='search')return;clearTimeout(titleTimers.get(n.id));const text=n.type==='thread'?(n.messages||[]).filter(m=>m.text&&!m.error).map(m=>m.role+': '+m.text).join('\n'):sourceText(n);if(!text?.trim()||(n.type==='plan'&&!n.body?.trim()))return;titleTimers.set(n.id,setTimeout(()=>{titleTimers.delete(n.id);generateNodeTitle(n,text.slice(0,10000));},600));}
async function generateNodeTitle(n,text){if(nodeById(n.id)!==n||n.titleEdited||n.titleGenerated)return;const original=n.title;const controller=new AbortController();titleRequests.set(n.id,controller);try{const result=await fetch('/api/title',{method:'POST',headers:{'Content-Type':'application/json',...window.BoardShared?.headers()},body:JSON.stringify({text}),signal:controller.signal});if(!result.ok)return;const data=await result.json();if(nodeById(n.id)!==n||n.titleEdited||n.title!==original||document.activeElement===cardEl(n.id)?.querySelector('.node-label')||!data.title)return;n.title=data.title;n.titleGenerated=true;const el=cardEl(n.id),label=el?.querySelector('.node-label');if(label&&document.activeElement!==label)label.textContent=n.title;el?.setAttribute('aria-label',n.type+' card: '+n.title);for(const [selector,prefix]of [['.title-grip','Move '],['.delete-card','Delete '],['.resize-handle','Resize '],['.nib','Drag context from '],['[data-prompt]','Message in ']])el?.querySelector(selector)?.setAttribute('aria-label',prefix+n.title);save();}catch{}finally{titleRequests.delete(n.id);}}
const streamPaintState=new WeakMap();
function renderStreamText(el,text){
 const fragment=document.createElement('div');fragment.innerHTML=messageHTML(text);const visible=fragment.textContent,now=performance.now();let state=streamPaintState.get(el);if(!state)state={previous:el.textContent,births:Array(el.textContent.length).fill(-Infinity)};
 let common=0;while(common<state.previous.length&&common<visible.length&&state.previous[common]===visible[common])common++;state.births.length=common;while(state.births.length<visible.length)state.births.push(now);state.previous=visible;streamPaintState.set(el,state);
 const walker=document.createTreeWalker(fragment,NodeFilter.SHOW_TEXT);const leaves=[];while(walker.nextNode())leaves.push(walker.currentNode);let offset=0;
 for(const leaf of leaves){if(leaf.parentElement?.closest('[data-math]')){offset+=leaf.textContent.length;continue;}const parts=document.createDocumentFragment();for(const token of leaf.textContent.match(/\s+|\S+/g)||[]){const age=now-Math.max(...state.births.slice(offset,offset+token.length));offset+=token.length;if(!reduced.matches&&age<130&&token.trim()){const span=document.createElement('span');span.className='stream-token';span.textContent=token;span.style.animationDelay=(-age)+'ms';parts.append(span);}else parts.append(document.createTextNode(token));}leaf.replaceWith(parts);}el.replaceChildren(...fragment.childNodes);
}

function websitePerspectiveButton(n){return n.type==='web'&&!n.researchSource?`<button type="button" class="website-perspective-toggle" data-website-perspective aria-label="Your perspective" data-tooltip="Your perspective" aria-expanded="${openWebsitePerspectives.has(n.id)}" aria-controls="website-perspective-${n.id}">${icon('user')}</button>`:'';}
function toggleWebsitePerspective(n,open){const card=cardEl(n.id),section=card?.querySelector('.website-perspective'),button=card?.querySelector('[data-website-perspective]');if(!section||!button)return;if(open)openWebsitePerspectives.add(n.id);else{if(section.contains(document.activeElement))document.activeElement.blur();openWebsitePerspectives.delete(n.id);hideSelection();}section.hidden=!open;button.setAttribute('aria-expanded',String(open));if(open)section.querySelector('.website-notes')?.focus({preventScroll:true});else button.focus({preventScroll:true});requestDraw();}
onCardEvent('keydown',e=>{if(e.key==='Escape'&&e.target.closest('.website-perspective')){const n=nodeById(e.target.closest('.card').dataset.node);e.preventDefault();e.stopImmediatePropagation();toggleWebsitePerspective(n,false);}});
function sourceInfoButton(n){return ['plan','media','web','upload','thread','github'].includes(n.type)?`<button type="button" data-source-info aria-label="Inspect source context" title="Context details" aria-haspopup="dialog" aria-controls="context-inspector">${icon('info-circle')}</button>`:'';}
function sourceInfoMarkup(n){if(!inspectedSources.has(n.id))return '';const video=n.type==='media'&&n.mediaType==='video';const notice=video&&!n.transcript?(videoErrors.get(n.videoId)||'Captions are loading. Connecting this video includes its transcript once ready; Send waits for retrieval.'):n.type==='web'?'Chats receive this URL and your perspective notes. AI looks up the page when you send, with citations in its reply. Some sites may block access.':n.type==='upload'&&!n.text?(n.storageId?(n.mime==='application/pdf'?'Chats receive the complete PDF, including page images and text.':/^image\/(png|jpeg|webp|gif)$/.test(n.mime)?'Chats receive the image itself for visual analysis.':'This file format is not supported in chat. Use a PDF, supported image, or text file.'):'Enable chat context to make this file available, then refresh existing chat references.'):n.type==='media'&&n.mediaType!=='video'?'Chats receive the image itself and its source attribution.':'';return `<section id="source-context-${n.id}" class="source-context-detail" aria-label="Source context details"><h3>${video&&n.transcript?'Transcript & context':'Context shared with chats'}</h3>${notice?`<p class="source-context-status">${escapeHTML(notice)}</p>`:''}<pre>${escapeHTML(sourceText(n)||'No context yet.')}</pre><p class="source-context-footnote">Connected chats keep the snapshot from when this source was attached. Inspect the source inside a chat to see that snapshot.</p></section>`;}

function messageNibMarkup(m){return m.text?.trim()?`<button class="message-branch" data-branch-point="${m.id}" aria-label="Branch conversation at this message" title="Branch from here"><span class="context-pill"></span></button>`:"";}

function modelTriggerMarkup(stage){return `<span class="model-trigger-mark">${icon(stage===2?'flash':'brain')}</span><span>${['Think','Auto','Fast'][stage]}</span>${icon('nav-arrow-down')}`;}
function modelPickerMarkup(n){const stage=Number.isInteger(n.modelStage)?Math.max(0,Math.min(2,n.modelStage)):1;const balance=Number.isFinite(n.modelBalance)?Math.max(0,Math.min(100,n.modelBalance)):stage*50;const names=['Thoughtful','Balanced','Fast'];return `<details class="model-picker"><summary aria-label="Choose thinking and speed" data-tooltip="Thinking & speed">${modelTriggerMarkup(stage)}</summary><div class="model-popover"><div class="model-slider-row"><span data-tooltip="More thinking">${icon('brain')}</span><div class="model-slider-track"><input type="range" data-model-stage min="0" max="100" step="0.1" value="${balance}" aria-label="Thinking and speed" aria-valuetext="${names[stage]} reasoning"></div><span data-tooltip="More speed">${icon('flash')}</span></div><details class="model-select"><summary aria-label="Choose model"><span>GPT-5.4 mini</span>${icon('nav-arrow-down')}</summary><div class="model-options"><button type="button" data-select-model aria-label="GPT-5.4 mini, selected"><span>GPT-5.4 mini</span><span class="model-selected" aria-hidden="true">✓</span></button></div></details></div></details>`;}
$('#cards').addEventListener('input',e=>{if(!e.target.matches('[data-model-stage]'))return;const n=nodeById(e.target.closest('.card').dataset.node);if(!n)return;n.modelBalance=Number(e.target.value);n.modelStage=Math.min(2,Math.floor(n.modelBalance/ (100/3)));const name=['Thoughtful','Balanced','Fast'][n.modelStage];e.target.setAttribute('aria-valuetext',name+' reasoning');e.target.closest('.model-picker').querySelector(':scope > summary').innerHTML=modelTriggerMarkup(n.modelStage);});
$('#cards').addEventListener('change',e=>{if(e.target.matches('[data-model-stage]'))save();});
$('#cards').addEventListener('click',async e=>{const button=e.target.closest('[data-select-model]');if(button){const menu=button.closest('.model-select');menu.open=false;menu.querySelector('summary').focus({preventScroll:true});}});
document.addEventListener('pointerdown',e=>{document.querySelectorAll('.model-picker[open]').forEach(p=>{if(!p.contains(e.target))p.open=false;});},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelectorAll('.model-picker[open]').forEach(p=>{p.open=false;p.querySelector('summary').focus({preventScroll:true});});}});

function expandIdeaButton(n){return BranchContext.hasContent(n)?`<button type="button" data-expand-idea data-tooltip="Expand on idea" aria-label="Expand on idea" aria-expanded="${ideaPreviews.has(n.id)}" ${expandingIdeas.has(n.id)?'disabled aria-busy="true"':''}>${icon('brain')}</button>`:'';}
function ideaPreviewMarkup(n){
 const preview=ideaPreviews.get(n.id);if(!preview)return '';
 const count=preview.ideas?.filter(idea=>idea.selected).length||0;
 const paths=[24,86,148].map(y=>`<path d="M 0 86 C 36 86 28 ${y} 64 ${y}"/>`).join('');
 return `<section class="idea-preview ${!preview.ideas&&!preview.error?'is-loading':''}" aria-label="Explore ideas" style="left:${preview.x}px;top:${preview.y}px">
 <svg class="idea-twigs" width="64" height="172" aria-hidden="true">${paths}</svg>
 <div class="idea-preview-heading"><span role="status">${preview.error?'Couldn’t find directions':preview.ideas?'Choose topics · edit any prompt':'Finding three directions…'}</span><button data-close-ideas aria-label="Close idea previews">${icon('xmark')}</button></div>
 ${preview.error?`<div class="idea-error"><p>${escapeHTML(preview.error)}</p><button data-expand-idea>Try again</button></div>`:preview.ideas?preview.ideas.map((idea,i)=>`<div class="idea-option ${idea.selected?'is-selected':''}"><button class="idea-select" data-select-idea="${i}" aria-pressed="${!!idea.selected}" aria-label="Select topic: ${escapeHTML(idea.title)}">${icon('check')}</button><button class="idea-topic" data-edit-idea="${i}" aria-expanded="${preview.editing===i}" aria-label="Edit prompt: ${escapeHTML(idea.title)}"><span class="idea-topic-label">${escapeHTML(idea.title)}</span>${icon('nav-arrow-down')}</button></div>`).join(''):[0,1,2].map(i=>`<div class="idea-option" style="--idea-delay:${i*160}ms"><div class="idea-topic idea-loading" aria-hidden="true"><span class="idea-dot"></span><i style="width:${[126,156,108][i]}px"></i><span class="idea-shimmer"></span></div></div>`).join('')}
 ${preview.ideas?`<div class="idea-preview-actions"><button class="launch-ideas" data-launch-ideas ${count?'':'disabled'}>${count?`Branch into ${count} topic${count===1?'':'s'}`:'Choose topics to branch'} ${icon('arrow-up-right')}</button></div>${Number.isInteger(preview.editing)?`<div class="idea-editor"><label for="idea-prompt-${n.id}">${escapeHTML(preview.ideas[preview.editing].title)}</label><textarea id="idea-prompt-${n.id}" data-idea-prompt="${preview.editing}" aria-label="Edit topic prompt" rows="3">${escapeHTML(preview.ideas[preview.editing].prompt)}</textarea><button data-done-idea>Done</button></div>`:''}`:''}</section>`;
}
function updateIdeaPreview(n){
 const card=cardEl(n.id);if(!card)return;
 card.querySelector('.idea-preview')?.remove();card.insertAdjacentHTML('beforeend',ideaPreviewMarkup(n));
 const button=card.querySelector('.header-actions [data-expand-idea]');if(button)button.outerHTML=expandIdeaButton(n);
 const panel=card.querySelector('.idea-preview');if(panel&&!card.closest('#chat-panel')){const r=panel.getBoundingClientRect();let dx=r.right>innerWidth-28?innerWidth-28-r.right:r.left<28?28-r.left:0,dy=r.bottom>innerHeight-100?innerHeight-100-r.bottom:0;if(dx||dy){camera.x+=dx;camera.y+=dy;applyCamera();}}
}
async function expandIdea(source,event){
 if(!BranchContext.hasContent(source)||expandingIdeas.has(source.id)||window.BoardShared&&!window.BoardShared.writable)return;
 if(ideaPreviews.get(source.id)?.ideas){cardEl(source.id)?.querySelector('[data-launch-ideas]')?.focus();return;}
 if(source.type==='media'&&source.mediaType==='video'&&!source.transcript){await loadVideoTranscript(source);if(!source.transcript)return notify(videoErrors.get(source.videoId)||'Wait for captions to load.');}
 const x=(source.width||cardEl(source.id).offsetWidth)+64;
 const snapshot=contextSnapshot(source),resolved=BranchContext.resolveContext([snapshot]),controller=new AbortController();
 const preview={x,y:20,originX:-64,snapshot,ideas:null};
 ideaPreviews.set(source.id,preview);expandingIdeas.set(source.id,controller);updateIdeaPreview(source);
 const panel=cardEl(source.id)?.querySelector('.idea-preview');
 if(!reduced.matches&&event?.detail)panel?.animate([{opacity:0,transform:'translateX(-12px) scale(.96)'},{opacity:1,transform:'none'}],{duration:200,easing:'cubic-bezier(.2,.8,.2,1)'});
 try{
  const result=await fetch('/api/expand',{method:'POST',headers:{'Content-Type':'application/json',...window.BoardShared?.headers()},body:JSON.stringify({messages:[{role:'user',content:'Suggest three directions to explore this idea in greater depth.'}],contexts:resolved}),signal:controller.signal});
  const data=await result.json();if(!result.ok)throw Error(data.error||'Could not expand this idea.');
  if(!nodeById(source.id)||ideaPreviews.get(source.id)!==preview)return;
  if(!Array.isArray(data.ideas)||data.ideas.length!==3||data.ideas.some(i=>!i.title||!i.prompt))throw Error('No usable ideas returned. Please try again.');
  preview.ideas=data.ideas.map(idea=>({...idea,selected:false}));
 }catch(error){if(error.name!=='AbortError')preview.error=error.message;}
 finally{expandingIdeas.delete(source.id);if(nodeById(source.id))updateIdeaPreview(nodeById(source.id));}
}
async function launchIdeas(source){
 const preview=ideaPreviews.get(source.id);if(!preview?.ideas||window.BoardShared&&!window.BoardShared.writable)return;
 const panel=cardEl(source.id)?.querySelector('.idea-preview');
 if(!panel)return;
 for(const field of panel.querySelectorAll('[data-idea-prompt]'))preview.ideas[Number(field.dataset.ideaPrompt)].prompt=field.value;
 const selected=preview.ideas.map((idea,index)=>({idea,index})).filter(({idea})=>idea.selected);
 if(!selected.length){notify('Choose at least one topic to branch');return;}
 const prompts=preview.ideas.map(idea=>idea.prompt.trim());
 const origins=[...panel.querySelectorAll('[data-edit-idea]')].map(el=>{const rect=el.getBoundingClientRect();return boardPoint(rect.left,rect.top);});
 if(selected.some(({index})=>!prompts[index])){notify('Give each idea a prompt before launching');return;}
 ideaPreviews.delete(source.id);updateIdeaPreview(source);remember();
 let x=source.x+(source.width||cardEl(source.id).offsetWidth)+90,y=source.y;
 const nodes=selected.map(({idea,index:i})=>{
  const p=freePosition(x,y,440),n={id:id(),type:'thread',title:idea.title,titleGenerated:true,x:p.x,y:p.y,width:440,revision:1,autoGroup:source.id,contexts:[{...clone(preview.snapshot),id:id()}],messages:[],draft:prompts[i],modelStage:source.modelStage};
  state.nodes.push(n);refreshCard(n);x=p.x+510;
  if(!reduced.matches){const origin=origins[i]||{x:source.x,y:source.y},el=cardEl(n.id),animation=el.animate([{transform:`translate3d(${origin.x}px,${origin.y}px,0) scale(.96)`,opacity:0},{transform:`translate3d(${n.x}px,${n.y}px,0) scale(1)`,opacity:1}],{duration:300,easing:'cubic-bezier(.2,.8,.2,1)',id:'idea-entrance'});el.addEventListener('pointerdown',()=>animation.cancel(),{once:true});}
  return n;
 });
 record(`Launched ${nodes.length} topic${nodes.length===1?'':'s'}`);
 // Use the normal Send path so shared-board leases, snapshots and billing still apply.
 const redraw=()=>{requestDraw();if(nodes.some(n=>cardEl(n.id)?.getAnimations().some(a=>a.id==='idea-entrance'&&a.playState==='running')))requestAnimationFrame(redraw);};requestAnimationFrame(redraw);
 await Promise.allSettled(nodes.map(n=>send(n,{focus:false})));
}


window.BranchHost={boardPoint,screenPoint,prepareVideoTranscripts,readLocalFile,getState:()=>state,notify,refreshText(n){const el=cardEl(n.id);if(!el)return;for(const field of ['body','title']){const target=el.querySelector(`[data-edit="${field}"]`);if(target&&target.textContent!==(n[field]||''))target.textContent=n[field]||'';}const draft=el.querySelector('[data-prompt]');if(draft&&draft.value!==(n.draft||''))draft.value=n.draft||'';syncNib(n);if(n.type==='web'){const detail=el.querySelector('.source-context-detail pre');if(detail)detail.textContent=sourceText(n);}requestDraw();},receive(snapshot){
 const previous=new Map(state.nodes.map(n=>[n.id,n]));const result=[];
 for(const incoming of snapshot.nodes){if(gesture?.kind==='move'&&nodeById(gesture.source)?.agent&&incoming.autoGroup===gesture.source&&!gesture.members.some(item=>item.id===incoming.id)){gesture.members.push({id:incoming.id,x:incoming.x,y:incoming.y});incoming.x+=(gesture.lastX-gesture.sx)/camera.z;incoming.y+=(gesture.lastY-gesture.sy)/camera.z;}if(incoming.activeRun)generatingChats.set(incoming.id,{abort(){}});else generatingChats.delete(incoming.id);let n=previous.get(incoming.id);previous.delete(incoming.id);if(!n){n=incoming;state.nodes.push(n);refreshCard(n);}else{
 const oldMessages=n.messages||[],messages=incoming.messages||[];const sameMessages=oldMessages.length===messages.length&&oldMessages.every((m,i)=>m.id===messages[i].id);
 const structural=!!(incoming.agent&&window.BranchAvatar&&!cardEl(incoming.id)?.querySelector('.agent-avatar img'))||n.agent!==incoming.agent||n.agentName!==incoming.agentName||!!n.activeRun!==!!incoming.activeRun||n.agentStage!==incoming.agentStage||n.type!==incoming.type||n.collapsed!==incoming.collapsed||JSON.stringify(n.contexts)!==JSON.stringify(incoming.contexts)||!sameMessages||['image','videoId','url','mediaResults','creditOpen','text','transcript','transcriptLanguage'].some(k=>JSON.stringify(n[k])!==JSON.stringify(incoming[k]));
 const dragging=gesture&&(gesture.kind==='move'?gesture.members?.some(item=>item.id===n.id):gesture.kind==='resize'&&gesture.source===n.id);const position=dragging?{x:n.x,y:n.y,width:n.width,minHeight:n.minHeight}:null;
 for(const key of Object.keys(n))if(!(key in incoming))delete n[key];Object.assign(n,incoming,position||{});
 if(structural)refreshCard(n);else{window.BranchHost.refreshText(n);const el=cardEl(n.id);if(el){el.style.transform=`translate3d(${n.x}px,${n.y}px,0)`;el.style.width=(n.width||(n.type==='thread'?520:380))+'px';el.style.minHeight=(n.minHeight||0)+'px';for(const message of messages){const target=el.querySelector(`[data-message="${message.id}"] [data-message-text]`);const old=oldMessages.find(m=>m.id===message.id);if(target&&old?.text!==message.text){renderStreamText(target,message.text);const label=target.closest('.message').querySelector('.message-label');if(!label.querySelector('.message-branch'))label.insertAdjacentHTML('beforeend',messageNibMarkup(message));}if(message.error&&!old?.error)refreshCard(n);}}}
 }
 if(n.activeRun)generatingChats.set(n.id,{abort(){}});else generatingChats.delete(n.id);cardEl(n.id)?.setAttribute('aria-busy',String(!!n.activeRun));updateActivity(n);result.push(n);
 }
 for(const n of previous.values()){cardEl(n.id)?.remove();generatingChats.delete(n.id);}state.nodes=result;syncAgentStacks();mountChatPanel();state.title=snapshot.title;$('#board-title').textContent=state.title;requestDraw();
 try{localStorage.setItem(KEY,JSON.stringify(state));}catch{}
}};

// A compact creation dock; each action inserts a real editable board item.
const creationDock=document.createElement('nav');creationDock.id='creation-dock';creationDock.setAttribute('aria-label','Add to board');
const dockItems=[['thread','chat-bubble','Chat','C'],['agent','flash','Agent',''],['plan','page','Note','N'],['image','media-image','Image',''],['video','youtube','YouTube video',''],['file','attachment','Upload file',''],['website','link','Website',''],['github','github','GitHub',''],['search','search','Image search','S']];
creationDock.innerHTML=dockItems.map(([kind,glyph,label,key],i)=>`${kind==='website'?'<span class="dock-divider" aria-hidden="true"></span>':''}<button type="button" data-dock="${kind}" aria-label="${label}" aria-describedby="dock-tip-${kind}">${icon(glyph)}<span class="dock-tooltip" role="tooltip" id="dock-tip-${kind}">${label}${key?`<kbd>${key}</kbd>`:''}</span></button>`).join('');document.body.append(creationDock);
const firstUse=document.createElement('aside');firstUse.id='first-use-tip';firstUse.hidden=true;firstUse.setAttribute('role','status');firstUse.innerHTML=icon('info-circle')+'<span></span><button aria-label="Dismiss tip">'+icon('xmark')+'</button>';document.body.append(firstUse);
let firstUseTimer;
const tipCopy={thread:'Write a prompt and send. Another person editing this node will pause Send.',plan:'Write here. Select a thought to branch it into a conversation.',image:'Drag the blue nib to a chat to use this image as context.',video:'Play it here. Drag the blue nib to connect it to a chat.',file:'Your file is a node. Connect its blue nib to a chat.',website:'Use Perspective in the header to add optional context, then connect the blue nib to a chat.',search:'Search images, then drag a result onto your board.'};
function hideFirstUse(){clearTimeout(firstUseTimer);firstUse.hidden=true;}
function showFirstUse(kind){if(!tipCopy[kind])return;const key='branch-first-use-v1-'+kind;try{if(localStorage.getItem(key))return;localStorage.setItem(key,'seen');}catch{}clearTimeout(firstUseTimer);firstUse.querySelector('span').textContent=tipCopy[kind];firstUse.hidden=false;firstUseTimer=setTimeout(hideFirstUse,12000);}
firstUse.querySelector('button').onclick=hideFirstUse;firstUse.onpointerenter=()=>clearTimeout(firstUseTimer);firstUse.onpointerleave=()=>{firstUseTimer=setTimeout(hideFirstUse,5000)};firstUse.onfocusin=()=>clearTimeout(firstUseTimer);firstUse.onfocusout=()=>{firstUseTimer=setTimeout(hideFirstUse,5000)};
const dockLink=document.createElement('form');dockLink.id='dock-link';dockLink.hidden=true;dockLink.innerHTML='<label for="dock-url">Website</label><div><input id="dock-url" type="url" required autocomplete="off" spellcheck="false" placeholder="https://…"><button type="submit" aria-label="Add link">'+icon('arrow-up')+'</button></div><p role="alert" hidden></p>';document.body.append(dockLink);let dockLinkKind='website',dockLinkTrigger;
function dockPoint(){return freePosition((innerWidth/2-camera.x)/camera.z-220,(Math.max(170,innerHeight*.27)-camera.y)/camera.z,440);}
creationDock.onclick=e=>{const button=e.target.closest('[data-dock]');if(!button||(window.BoardShared?.enabled&&!window.BoardShared.writable))return;const kind=button.dataset.dock;hideFirstUse();dockLink.hidden=true;if(kind==='github'){window.dispatchEvent(new CustomEvent('branch:github',{detail:{trigger:button}}));return;}if(kind==='agent'){if(performance.now()<suppressAgentDockClickUntil)return;placeDockAgent(dockPoint(),true);return;}if(kind==='image'||kind==='file'){uploadPoint=dockPoint();uploadChat=null;$('#file-input').accept=kind==='image'?'image/*':'';$('#file-input').click();return;}if(kind==='video'||kind==='website'){dockLinkKind=kind;dockLinkTrigger=button;dockLink.querySelector('label').textContent=kind==='video'?'YouTube link':'Website link';dockLink.querySelector('input').placeholder=kind==='video'?'https://youtube.com/watch?v=…':'https://…';dockLink.querySelector('input').value='';dockLink.querySelector('p').hidden=true;dockLink.hidden=false;dockLink.querySelector('input').focus();return;}const node=newCard(kind,dockPoint());revealDockNode(node);cardEl(node.id).querySelector(kind==='thread'?'[data-prompt]':kind==='search'?'[data-query]':'.plan-body')?.focus({preventScroll:true});};
dockLink.onsubmit=e=>{e.preventDefault();if(!window.BoardShared?.enabled||!window.BoardShared.writable)return;const value=dockLink.querySelector('input').value.trim();let url;try{url=new URL(value);if(!['https:','http:'].includes(url.protocol))throw Error();}catch{return;}if(dockLinkKind==='video'){if(!insertVideoLink(value,dockPoint())){const error=dockLink.querySelector('p');error.textContent='Paste a YouTube video link.';error.hidden=false;return;}}else{remember();const point=dockPoint();const node={id:id(),type:'web',title:url.hostname,url:url.href,x:point.x,y:point.y,width:440,revision:1};state.nodes.push(node);refreshCard(node);record('Added website');showFirstUse('website');}revealDockNode(state.nodes[state.nodes.length-1]);dockLink.hidden=true;dockLinkTrigger?.focus();};
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#dock-link,#creation-dock'))dockLink.hidden=true;});
dockLink.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();dockLink.hidden=true;dockLinkTrigger?.focus();}};
creationDock.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const buttons=[...creationDock.querySelectorAll('button')],at=buttons.indexOf(document.activeElement);if(at<0)return;e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(at+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length].focus();};
// Other upload entry points should not inherit the dock's image-only filter.
$('#file-input').addEventListener('change',()=>{$('#file-input').accept='';});

$('#file-input').addEventListener('cancel',()=>{$('#file-input').accept='';});

// Bridge for the GitHub panel (accounts UI): placement, reveal, and card refresh.
window.BranchCanvas={dockPoint:()=>dockPoint(),reveal(id,tries=20){const node=nodeById(id);if(node){revealDockNode(node);return;}if(tries>0)setTimeout(()=>window.BranchCanvas.reveal(id,tries-1),150);}};
$('#cards').addEventListener('click',async e=>{const button=e.target.closest('[data-github-refresh]');if(!button)return;const id=button.closest('.card')?.dataset.node;if(!id||!window.BranchGitHub)return;button.disabled=true;button.querySelector('span').textContent='Refreshing…';const error=await window.BranchGitHub.refresh(id);if(!button.isConnected)return;button.disabled=false;button.querySelector('span').textContent=error?'Couldn’t refresh':'Refresh';if(error){button.dataset.tooltip=error;setTimeout(()=>{if(button.isConnected){button.querySelector('span').textContent='Refresh';delete button.dataset.tooltip;}},6000);}});
function revealDockNode(node){const el=cardEl(node?.id);if(!el)return;const r=el.getBoundingClientRect();let dx=0,dy=0;if(r.left<35)dx=35-r.left;else if(r.right>innerWidth-35)dx=innerWidth-35-r.right;const bottom=innerHeight-155;if(r.height>bottom-125)dy=125-r.top;else if(r.bottom>bottom)dy=bottom-r.bottom;else if(r.top<125)dy=125-r.top;camera.x+=dx;camera.y+=dy;applyCamera();}

// Keep the live transcript and composer intact while unfolding the conversation.
function toggleConversation(n,event){
 const card=cardEl(n.id),surface=card?.querySelector('.chat-surface');if(!surface)return;
 const from=parseFloat(getComputedStyle(surface).height),opening=!expandedChats.has(n.id);
 surface.getAnimations().filter(a=>a.id==='conversation-unfold').forEach(a=>{a.oncancel?.();a.oncancel=null;a.cancel();});
 opening?expandedChats.add(n.id):expandedChats.delete(n.id);
 card.classList.toggle('compact-chat',compactChat(n));
 surface.tabIndex=compactChat(n)?-1:0;
 const toggle=card.querySelector('.chat-preview-toggle'),header=card.querySelector('.collapse-card');
 if(toggle){toggle.setAttribute('aria-expanded',String(!compactChat(n)));toggle.innerHTML=`${compactChat(n)?'Show conversation':'Show less'} ${icon('nav-arrow-down')}`;}
 if(header){header.setAttribute('aria-expanded',String(!compactChat(n)));header.setAttribute('aria-label',`${compactChat(n)?'Expand':'Collapse'} conversation`);header.dataset.tooltip=compactChat(n)?'Expand':'Collapse';header.removeAttribute('title');}
 const to=parseFloat(getComputedStyle(surface).height);
 if(event.detail===0||matchMedia('(prefers-reduced-motion: reduce)').matches||Math.abs(to-from)<1){requestDraw();return;}
 // A measured height keeps the composer and connected wires attached to the reveal.
 // Remove all constraints at rest so later streamed messages grow naturally.
 const messages=surface.querySelector('.messages');
 surface.style.maxHeight='none';surface.style.overflow='hidden';surface.style.flex='none';
 if(messages){messages.style.maxHeight='none';messages.style.maskImage='none';}
 const cleanup=()=>{
  surface.style.removeProperty('max-height');surface.style.removeProperty('overflow');surface.style.removeProperty('flex');
  if(messages){messages.style.removeProperty('max-height');messages.style.removeProperty('mask-image');}
  requestDraw();
 };
 const animation=surface.animate([{height:`${from}px`},{height:`${to}px`}],{duration:opening?250:190,easing:'cubic-bezier(.23,1,.32,1)',id:'conversation-unfold'});
 animation.onfinish=cleanup;animation.oncancel=cleanup;
}

function updateActivity(n){
 const surface=cardEl(n.id)?.querySelector('.chat-surface');if(!surface)return;
 let el=surface.querySelector('.chat-activity');const busy=!!n.activeRun||generatingChats.has(n.id);
 const phase=n.activity||'thinking',label=phase==='searching'?'Searching':phase==='writing'?'Writing':'Thinking';
 const agent=cardEl(n.id)?.querySelector('.agent-identity');if(agent){agent.dataset.running=String(busy);const progress=agent.querySelector('.agent-progress');if(progress)progress.hidden=!busy;const status=agent.querySelector('[data-agent-status]');if(status)status.textContent=busy?((n.agentStage||'Discovering pages')+' · '+label):(n.agentStage||'Ready for a goal');}
 if(!busy){el?.remove();return;}
 if(!el){el=document.createElement('div');el.className='chat-activity';el.setAttribute('role','status');el.setAttribute('aria-live','polite');surface.append(el);}
 if(el.dataset.phase!==phase){el.dataset.phase=phase;el.innerHTML=icon(phase==='searching'?'search':phase==='thinking'?'brain':'chat-bubble')+'<span>'+label+'</span><i aria-hidden="true"></i>';}
}

function mountChatPanel(){
 const panel=document.getElementById('chat-panel');
 panelContentObserver?.disconnect();panelContentObserver=null;
 if(!panelNodeId||!nodeById(panelNodeId)){panelNodeId=null;panel?.remove();document.querySelectorAll('[data-panel-placeholder]').forEach(el=>el.remove());document.body.classList.remove('chat-panel-open');return;}
 const n=nodeById(panelNodeId),card=cardEl(n.id);if(!card)return;
 let surface=panel;
 if(!surface){surface=document.createElement('aside');surface.id='chat-panel';surface.setAttribute('aria-label','Chat side panel');surface.innerHTML='<div class="chat-panel-toolbar"><span>Shared conversation</span><button type="button" data-close-chat-panel aria-label="Close chat panel" data-tooltip="Return to canvas">'+icon('xmark')+'</button></div><div class="chat-panel-content"></div>';document.body.append(surface);surface.querySelector('[data-close-chat-panel]').onclick=closeChatPanel;}
 if(card.parentElement!==surface.querySelector('.chat-panel-content'))surface.querySelector('.chat-panel-content').append(card);
 let placeholder=document.querySelector(`[data-panel-placeholder="${n.id}"]`);
 if(!placeholder){placeholder=document.createElement('button');placeholder.className='panel-placeholder';placeholder.dataset.panelPlaceholder=n.id;placeholder.onclick=()=>cardEl(n.id)?.querySelector('[data-prompt]')?.focus({preventScroll:true});$('#cards').append(placeholder);}
 placeholder.style.cssText=`transform:translate(${n.x}px,${n.y}px);width:${n.width||520}px`;
 placeholder.innerHTML=icon('chat-bubble')+'<span>'+escapeHTML(n.title)+'</span><small>Open in side panel</small>';
 document.body.classList.add('chat-panel-open');
 const transcript=card.querySelector('.chat-surface'),messages=card.querySelector('.messages');
 if(transcript&&messages){let following=transcript.scrollHeight-transcript.scrollTop-transcript.clientHeight<60;transcript.onscroll=()=>{following=transcript.scrollHeight-transcript.scrollTop-transcript.clientHeight<60;};panelContentObserver=new ResizeObserver(()=>{if(following)transcript.scrollTop=transcript.scrollHeight;});panelContentObserver.observe(messages);}
}

function openChatPanel(n){
 if(panelNodeId===n.id)return;
 closeChatPanel(false);commitEdit();panelNodeId=n.id;refreshCard(n);
 const panel=$('#chat-panel');if(!reduced.matches)panel.animate([{opacity:0,transform:'translateX(20px)'},{opacity:1,transform:'none'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});
 cardEl(n.id)?.querySelector('[data-prompt]')?.focus({preventScroll:true});
}
function closeChatPanel(focus=true){
 if(!panelNodeId)return;
 document.activeElement?.blur();commitEdit();const n=nodeById(panelNodeId),card=cardEl(panelNodeId);panelNodeId=null;
 if(card)$('#cards').append(card);mountChatPanel();if(n){refreshCard(n);if(focus)cardEl(n.id)?.querySelector('.open-chat-panel')?.focus({preventScroll:true});}requestDraw();
}

// Agents keep their identity, goal and controls on the canvas.
const agentNameAdjectives=['Cosmic','Disco','Turbo','Zippy','Neon','Bouncy','Fizzy','Sunny','Groovy','Peppy','Rocket','Jolly','Wobbly','Spicy','Snappy','Electric'];
const agentNameNouns=['Pickle','Mango','Otter','Noodle','Comet','Waffle','Gecko','Sprout','Puffin','Peach','Biscuit','Jellybean','Kiwi','Panda','Taco','Doodle'];
function agentIdentitySeed(n){let seed=2166136261;for(const c of n.id)seed=Math.imul(seed^c.charCodeAt(0),16777619);return seed>>>0;}
function agentHue(n){return agentIdentitySeed(n)%360;}
function agentColor(n){
 const h=agentHue(n)/60,c=.78,x=c*(1-Math.abs(h%2-1)),m=.16;
 const rgb=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];
 return '#'+rgb.map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');
}
function ensureAgentIdentity(n){if(!n.agentName){const seed=agentIdentitySeed(n);n.agentName=agentNameAdjectives[(seed>>>8)%agentNameAdjectives.length]+' '+agentNameNouns[(seed>>>16)%agentNameNouns.length];}return n.agentName;}
function agentIdentityMarkup(n){const name=n.agentName||'Scout',busy=!!n.activeRun||generatingChats.has(n.id),avatar=window.BranchAvatar?.('Agent '+name+' '+n.id,agentColor(n),true);return `<section class="agent-identity" style="--agent-color:${agentColor(n)};--agent-ink:hsl(${agentHue(n)} 78% 32%)" data-running="${busy}" aria-label="${escapeHTML(name)} research agent"><div class="agent-avatar">${avatar?`<img src="${escapeHTML(avatar)}" alt="${escapeHTML(name)} avatar">`:icon('brain')}<i aria-hidden="true"></i></div><div class="agent-heading"><strong>${escapeHTML(name)}</strong><span role="status" data-agent-status>${escapeHTML(busy?(n.agentStage||'Discovering pages'):n.agentStage||'Ready for a goal')}</span></div>${busy?`<button type="button" data-stop-agent aria-label="Stop ${escapeHTML(name)}" data-tooltip="Stop research">${icon('xmark')}</button>`:''}<button type="button" class="workspace-toggle" data-workspace-toggle aria-label="Toggle agent workspace" aria-expanded="${!collapsedAgentWorkspaces.has(n.id)}">${icon('nav-arrow-down')}</button><div class="agent-progress" role="progressbar" aria-label="Research in progress"${busy?'':' hidden'}><i></i></div></section>`;}
function measuredNodes(){return state.nodes.map(n=>({...n,layoutHeight:cardEl(n.id)?.offsetHeight||n.layoutHeight}));}
let settlingAutoNodes=false;
function settleAutomaticNodes(){if(settlingAutoNodes||gesture||!window.BranchAutoLayout||window.BoardShared?.enabled&&!window.BoardShared.writable)return;settlingAutoNodes=true;let changed=false;try{const occupied=measuredNodes().filter(n=>!n.autoGroup||n.agent);for(const n of state.nodes.filter(n=>n.autoGroup&&!n.agent&&!collapsedAgentSource(n))){const el=cardEl(n.id);if(!el||n.id===panelNodeId)continue;const h=el.offsetHeight||n.layoutHeight||260;const point=BranchAutoLayout.place(occupied,{x:n.x,y:n.y},el.offsetWidth||n.width||440,h);if(point.x!==n.x||point.y!==n.y){n.x=point.x;n.y=point.y;el.style.transform=`translate3d(${n.x}px,${n.y}px,0)`;changed=true;}if(Math.abs((n.layoutHeight||0)-h)>2){n.layoutHeight=h;changed=true;}occupied.push({...n,layoutHeight:h});}if(changed)save();}finally{settlingAutoNodes=false;}}
function agentSources(agent){return state.nodes.filter(n=>n.researchSource&&n.autoGroup===agent.id);}
function collapsedWorkspaceMember(n){return !!(n.autoGroup&&n.id!==n.autoGroup&&collapsedAgentWorkspaces.has(n.autoGroup));}
function collapsedAgentSource(n){return collapsedWorkspaceMember(n)||!!(n.researchSource&&nodeById(n.autoGroup)?.agent&&!expandedAgentSources.has(n.autoGroup)&&n.id!==panelNodeId);}
function groupMoveMembers(n){return n?.agent?state.nodes.filter(member=>member.id===n.id||member.autoGroup===n.id):n?[n]:[];}
function positionCard(n){const el=cardEl(n.id);if(el)el.style.transform=`translate3d(${n.x}px,${n.y}px,0)`;}
function agentStackBounds(n){return{x:n.x-310,y:n.y,w:240,h:64+agentSources(n).length*34};}
function syncAgentStacks(){
 let layer=$('#agent-stacks');if(!layer){layer=document.createElement('div');layer.id='agent-stacks';$('#world').append(layer);}
 for(const n of state.nodes){const el=cardEl(n.id);if(el){el.hidden=collapsedAgentSource(n);el.classList.toggle('workspace-folded',!!(n.agent&&collapsedAgentWorkspaces.has(n.id)));const toggle=el.querySelector('[data-workspace-toggle]');toggle?.setAttribute('aria-expanded',String(!collapsedAgentWorkspaces.has(n.id)));}}
 const visible=new Set();
 for(const agent of state.nodes.filter(n=>n.agent)){
  const sources=agentSources(agent);if(!sources.length||collapsedAgentWorkspaces.has(agent.id))continue;visible.add(agent.id);
  let stack=[...layer.children].find(el=>el.dataset.agentStack===agent.id);
  if(!stack){stack=document.createElement('div');stack.className='agent-source-stack';stack.dataset.agentStack=agent.id;const button=document.createElement('button');button.type='button';button.className='agent-stack-toggle';button.innerHTML=icon('link')+'<span><strong></strong><small></small></span>'+icon('nav-arrow-down');stack.append(button);layer.append(stack);button.onclick=()=>toggleAgentSources(agent.id);}
  const expanded=expandedAgentSources.has(agent.id),p=agentStackBounds(agent);
  Object.assign(stack.style,{transform:`translate3d(${p.x}px,${p.y}px,0)`,width:p.w+'px'});
  stack.classList.toggle('is-expanded',expanded);
  const button=stack.querySelector('button');button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',(expanded?'Collapse':'Expand')+' '+sources.length+' context sources for '+(agent.agentName||'agent'));
  const label=sources.length+' context source'+(sources.length===1?'':'s');if(stack.querySelector('strong').textContent!==label)stack.querySelector('strong').textContent=label;
  let list=stack.querySelector('.agent-source-rows');if(!list){list=document.createElement('div');list.className='agent-source-rows';stack.append(list);}const signature=JSON.stringify(sources.map(n=>[n.id,n.title,n.url]));if(list.dataset.signature!==signature){list.dataset.signature=signature;list.innerHTML=sources.map(n=>`<a class="agent-source-row" data-source-row="${escapeHTML(n.id)}" href="${escapeHTML(n.url)}" target="_blank" rel="noopener noreferrer">${icon('link')}<span>${escapeHTML(n.title)}</span><i class="source-row-port" aria-hidden="true"></i></a>`).join('');}list.hidden=expanded;
  const detail=expanded?'Return to list':'Open source cards';if(stack.querySelector('small').textContent!==detail)stack.querySelector('small').textContent=detail;
 }
 for(const stack of [...layer.children])if(!visible.has(stack.dataset.agentStack))stack.remove();
}
function toggleAgentSources(key){
 const stack=$$('[data-agent-stack]').find(el=>el.dataset.agentStack===key),button=stack?.querySelector('button');
 if(expandedAgentSources.has(key)){const hiddenIDs=new Set(agentSources(nodeById(key)).map(n=>n.id));if(hiddenIDs.has(document.activeElement?.closest('.card')?.dataset.node))button?.focus({preventScroll:true});expandedAgentSources.delete(key);}else expandedAgentSources.add(key);
 syncAgentStacks();observeCards();settleAutomaticNodes();requestDraw();button?.focus({preventScroll:true});
}
function drawAutoGroups(){
 let layer=$('#auto-groups');if(!layer){layer=document.createElement('div');layer.id='auto-groups';layer.setAttribute('aria-hidden','true');$('#world').prepend(layer);}
 const groups=new Map();for(const n of state.nodes){if(!n.autoGroup)continue;if(!groups.has(n.autoGroup))groups.set(n.autoGroup,[]);groups.get(n.autoGroup).push(n);}
 const visible=new Set();for(const [key,members]of groups){
  const parent=nodeById(key);if(parent&&!members.includes(parent))members.push(parent);if(members.length<2)continue;visible.add(key);
  let box=[...layer.children].find(el=>el.dataset.group===key);if(!box){box=document.createElement('div');box.className='auto-group-outline';box.dataset.group=key;layer.append(box);}
  const bounds=members.filter(n=>!collapsedAgentSource(n)).map(n=>({x:n.x,y:n.y-49,w:cardEl(n.id)?.offsetWidth||n.width||440,h:(cardEl(n.id)?.offsetHeight||n.layoutHeight||260)+49}));
  if(parent?.agent&&!collapsedAgentWorkspaces.has(parent.id)&&agentSources(parent).length)bounds.push(agentStackBounds(parent));
  const padding=48,left=Math.min(...bounds.map(b=>b.x))-padding,top=Math.min(...bounds.map(b=>b.y))-padding-20;
  Object.assign(box.style,{left:left+'px',top:top+'px',width:Math.max(...bounds.map(b=>b.x+b.w))-left+padding+'px',height:Math.max(...bounds.map(b=>b.y+b.h))-top+padding+'px'});
  box.textContent=(parent?.agentName||parent?.title||'Research')+' / '+members.length+' nodes';
 }
 for(const box of [...layer.children])if(!visible.has(box.dataset.group))box.remove();
}

// The dock holds the next agent; its identity travels with the full card.
let dockAgent=null,suppressAgentDockClickUntil=0;
function stockDockAgent(animate=false){
 dockAgent={id:id(),type:'thread',agent:true,x:0,y:0,width:520,revision:1,author:'You',messages:[],contexts:[],draft:''};
 ensureAgentIdentity(dockAgent);dockAgent.title=dockAgent.agentName;dockAgent.titleEdited=true;dockAgent.autoGroup=dockAgent.id;
 paintDockAgent();const avatar=creationDock.querySelector('.dock-agent-avatar');
 if(animate&&!reduced.matches&&avatar?.animate)avatar.animate([{opacity:0,transform:'translateY(12px) scale(.65)'},{opacity:1,transform:'translateY(-2px) scale(1.05)',offset:.75},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});
}
function paintDockAgent(){
 const button=creationDock.querySelector('[data-dock="agent"]');if(!button||!dockAgent)return;
 const avatar=window.BranchAvatar?.('Agent '+dockAgent.agentName+' '+dockAgent.id,agentColor(dockAgent),true);
 button.querySelector('.dock-agent-avatar')?.remove();button.querySelector(':scope > .icon')?.remove();
 button.style.setProperty('--agent-color',agentColor(dockAgent));
 button.setAttribute('aria-label',dockAgent.agentName);
 const tooltip=button.querySelector('.dock-tooltip');if(tooltip)tooltip.textContent=dockAgent.agentName;
 button.insertAdjacentHTML('afterbegin',`<span class="dock-agent-avatar" aria-hidden="true">${avatar?`<img draggable="false" src="${escapeHTML(avatar)}" alt="">`:icon('brain')}</span>`);
}
function updateAgentDrag(g,x,y){
 let preview=$('#agent-drag-preview');
 const dockRect=creationDock.getBoundingClientRect();
 const insideDock=x>=dockRect.left&&x<=dockRect.right&&y>=dockRect.top&&y<=dockRect.bottom;
 if(!insideDock)g.leftDock=true;
 if(preview&&g.leftDock&&insideDock){
  const avatar=creationDock.querySelector('.dock-agent-avatar'),target=avatar.getBoundingClientRect(),at=boardPoint(target.left+target.width/2,target.top+target.height/2);
  preview.removeAttribute('id');preview.className='agent-return-preview';
  finishGesture();
  if(reduced.matches||!preview.animate){preview.remove();return;}
  preview.style.transformOrigin=`${g.previewPoint.x}px ${g.previewPoint.y}px`;
  const animation=preview.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${at.x-g.previewPoint.x}px,${at.y-g.previewPoint.y}px) scale(.04)`,opacity:0}],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
  animation.finished?.then(()=>preview.remove(),()=>preview.remove());setTimeout(()=>preview.remove(),220);
  return;
 }
 if(!preview){preview=document.createElement('div');preview.id='agent-drag-preview';preview.setAttribute('aria-hidden','true');preview.inert=true;preview.innerHTML=cardMarkup(dockAgent,state.nodes.length);$('#world').append(preview);creationDock.classList.add('agent-in-hand');}
 const at=boardPoint(x,y);g.previewPoint={x:at.x-42,y:at.y-48};
 preview.firstElementChild.style.transform=`translate3d(${g.previewPoint.x}px,${g.previewPoint.y}px,0)`;
 preview.classList.toggle('invalid',!validMediaDrop(x,y));
}
function placeDockAgent(point,reveal=false){
 if(window.BoardShared?.enabled&&!window.BoardShared.writable)return;
 remember();const agent={...dockAgent,...point};state.nodes.push(agent);focused=agent.id;expandedChats.add(agent.id);refreshCard(agent);record('Created research agent');
 if(reveal)revealDockNode(agent);cardEl(agent.id)?.querySelector('[data-prompt]')?.focus({preventScroll:true});stockDockAgent(true);return agent;
}
creationDock.addEventListener('pointerdown',e=>{if(!e.target.closest('[data-dock="agent"]')||(window.BoardShared?.enabled&&!window.BoardShared.writable))return;hideFirstUse();startGesture(e,{kind:'agent'});});
creationDock.addEventListener('dragstart',e=>{if(e.target.closest('[data-dock="agent"]'))e.preventDefault();});
stockDockAgent();
// Accounts installs the local avatar renderer in the following script.
window.addEventListener('load',paintDockAgent,{once:true});


function openContextInspector(node,contextId=null){
 commitEdit();
 const previous=$('#context-inspector');if(previous)previous.close();
 const binding=contextId?node.contexts?.find(c=>c.id===contextId):BranchContext.snapshotNode(node,state.nodes);if(!binding)return;
 const snapshot=clone(binding),resolved=BranchContext.resolveContext([snapshot]),source=nodeById(snapshot.source),writable=!window.BoardShared?.enabled||window.BoardShared.writable;
 const dialog=document.createElement('dialog');dialog.id='context-inspector';dialog.setAttribute('aria-labelledby','context-inspector-title');
 const textBlock=text=>`<pre class="inspector-text">${escapeHTML(text)}</pre>`;
 const describe=(c,included)=>{
  if(!included)return 'Not sent to the model.';
  if(c.excerptOnly||c.enabled===false)return 'Only the selected passage is included.';
  if(c.video)return c.video.included?'Spoken captions included. Video visuals are not included.':'Captions still loading. Send waits until they are ready.';
  if(c.attachment)return c.attachment.kind==='image'?'The image itself is included for visual understanding.':c.attachment.kind==='pdf'?'The full PDF is included, with text and page images.':'Unsupported file. Replace it before sending.';
  const type=nodeById(c.source)?.type;
  if(type==='web')return 'URL and your notes included. The page is looked up when you send.';
  if(type==='thread')return c.cutoff?'Conversation up to the branch point is included.':'The saved conversation is included.';
  return 'This note’s text is included.';
 };
 const tree=(c,depth=0,parentEnabled=true)=>{
  const included=parentEnabled&&(c.enabled!==false||!!c.quote),full=parentEnabled&&c.enabled!==false,live=nodeById(c.source),text=included?(full?c.body||'':c.quote||''):'',children=depth<12?(c.inherited||[]):[];
  const symbol=c.attachment?.kind==='image'?'media-image':c.attachment?'attachment':c.video?'youtube':live?.type==='thread'?'chat-bubble':live?.type==='web'?'link':'page';
  return `<li>${children.length?`<ol class="inspector-upstream">${children.map(child=>tree(child,depth+1,full)).join('')}</ol><div class="inspector-flow" aria-hidden="true">↓</div>`:''}<article class="inspector-input inspector-node ${depth===0?'inspector-selected':''} ${!included?'inspector-excluded':''}"><div class="inspector-node-heading">${icon(symbol)}<strong>${escapeHTML(c.title||'Untitled')}</strong><span>${!included?'Excluded':depth===0?'This item':'Upstream'}</span></div><p class="inspector-node-description">${describe(c,included)}</p>${text?`<p class="inspector-snippet">${escapeHTML(text.slice(0,180))}${text.length>180?'…':''}</p>`:''}${included&&(text||c.quote||c.availability)?`<details><summary>View content</summary>${text?textBlock(text):''}${full&&c.quote&&c.quote!==text?textBlock(c.quote):''}${c.availability?`<p class="inspector-help">${escapeHTML(c.availability)}</p>`:''}</details>`:''}${live&&live.revision!==c.revision?'<p class="inspector-snapshot-status">Source has newer edits · saved version shown</p>':''}</article></li>`;
 };
 dialog.innerHTML=`<header class="inspector-header"><div><h2 id="context-inspector-title">Included context</h2><p>${contextId?'Saved for this chat':'Current source preview'} · ${resolved.length} ${resolved.length===1?'source':'sources'}</p></div><button type="button" data-inspector-close aria-label="Close context details">${icon('xmark')}</button></header><div class="inspector-body"><ol class="inspector-tree">${tree(snapshot)}</ol></div>${contextId?`<footer class="inspector-footer"><label><input type="checkbox" data-inspector-include ${snapshot.enabled!==false?'checked':''} ${!writable?'disabled':''}> Include source + upstream</label><div><button type="button" data-inspector-refresh ${!writable||!source?'disabled':''}>Refresh</button><button type="button" data-inspector-detach ${!writable?'disabled':''}>Detach</button></div></footer>`:''}`;
 dialog.addEventListener('keydown',e=>e.stopPropagation());
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 dialog.addEventListener('click',e=>{if(e.target.closest('[data-inspector-close]'))dialog.close();if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}const refresh=e.target.closest('[data-inspector-refresh]'),detachButton=e.target.closest('[data-inspector-detach]');if(!refresh&&!detachButton)return;if(window.BoardShared?.enabled&&!window.BoardShared.writable)return;const current=nodeById(node.id),c=current?.contexts?.find(c=>c.id===contextId);if(!c)return dialog.close();if(detachButton){detach(current,contextId);dialog.close();return;}const latest=nodeById(c.source);if(!latest)return;remember();Object.assign(c,contextSnapshot(latest,c.quote,c.cutoff),{id:c.id,enabled:c.enabled});refreshCard(current);record('Refreshed context snapshot');openContextInspector(current,contextId);});
 dialog.addEventListener('change',e=>{if(!e.target.matches('[data-inspector-include]')||(window.BoardShared?.enabled&&!window.BoardShared.writable))return;const current=nodeById(node.id),c=current?.contexts?.find(c=>c.id===contextId);if(!c)return dialog.close();remember();c.enabled=e.target.checked;refreshCard(current);record('Changed context inclusion');openContextInspector(current,contextId);});
 document.body.append(dialog);dialog.showModal();
}
