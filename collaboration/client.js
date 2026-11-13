import {avatarURL} from '../accounts/avatar';
import { ConvexClient } from 'convex/browser';
import * as Y from 'yjs';
import { prepareLocalFiles } from './prepare-files.cjs';

const fields = ['body','title','draft'];
const localOrigin = Symbol('local');
const copy = value => JSON.parse(JSON.stringify(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const bytes = value => Uint8Array.from(value).buffer;
const tabId = crypto.randomUUID();
const host = window.BranchHost;
let client, credentials, ready = false, applying = false, connected = false;
let rows = [], active = null, focusTask = Promise.resolve(), queue = Promise.resolve();
let lastState, timer, failure = null;
let writable=true;const subscriptions=[];
const uploadedFiles = new Map();
const docs = new Map(), pending = new Map(), overlays = new Map(), sending = new Set();
const deletedNodes = [], restoredNodes = [];
let deletionQueue = Promise.resolve();

function updateUndoButton() {
  const button = document.querySelector('#undo');
  if (button && ready) button.disabled = !writable || !deletedNodes.length;
}
function nodeHistoryAction(work) {
  deletionQueue = deletionQueue.then(async () => {
    if (!ready || !writable) return;
    await flush();
    if (!connected) throw Error('Reconnect before changing cards');
    await work();
    receive(await client.query('boards:read', args()));
  }).catch(error => host.notify(error.message)).finally(updateUndoButton);
  return deletionQueue;
}
function deleteNode(key) {
  return nodeHistoryAction(async () => {
    if (active?.key === key) {
      await focusTask;
      await client.mutation('collaboration:release', args({ tabId, nodeKey: key }));
      active = null;
    }
    const entry = { nodeKey: key, operationId: crypto.randomUUID() };
    await client.mutation('boards:deleteNode', args(entry));
    deletedNodes.push(entry);
    if (deletedNodes.length > 70) deletedNodes.shift();
    restoredNodes.length = 0;
    host.notify('Card removed · undo available');
  });
}
function undoDeletion(redo) {
  return nodeHistoryAction(async () => {
    const from = redo ? restoredNodes : deletedNodes, to = redo ? deletedNodes : restoredNodes;
    if (!from.length) return;
    const previous = from.at(-1);
    const entry = redo ? { ...previous, operationId: crypto.randomUUID() } : previous;
    await client.mutation(redo ? 'boards:deleteNode' : 'boards:restoreNode', args(entry));
    from.pop();to.push(entry);
    host.notify(redo ? 'Card removed again' : 'Card and connections restored');
  });
}

function status(text) { const el = document.querySelector('#save-state'); if(el) { el.textContent = text; el.title = text; } }
function args(extra = {}) { return { token: credentials.token, boardId: credentials.boardId, ...extra }; }
function enqueue(work) {
  const next = queue.then(work);
  queue = next.catch(error => { failure = error; keepRecovery(); status('Sync paused · edits kept on this device'); host.notify(error.message); updateLocks(); });
  return next;
}
function forgetDeletedNode(key) {
  if (pending.has(key)) keepRecovery();
  pending.delete(key);
  overlays.delete(key);
  const item = docs.get(key);
  item?.undo.destroy();
  item?.doc.destroy();
  docs.delete(key);
  if (active?.key === key) active = null;
}
function makeDoc(key, state, epoch) {
  let item = docs.get(key);
  if (!item) {
    const doc = new Y.Doc();
    if (state) Y.applyUpdate(doc, new Uint8Array(state));
    item = { doc, epoch, undo: new Y.UndoManager(fields.map(f => doc.getText(f)), { trackedOrigins: new Set([localOrigin]) }) };
    docs.set(key, item);
    doc.on('update', (update, origin) => {
      if (origin !== localOrigin && origin !== item.undo) return;
      const list = pending.get(key) || []; list.push(update); pending.set(key, list);
      schedule();
    });
  }
  return item;
}
function changeText(text, value) {
  const old = text.toString(); if (old === value) return;
  let left=0,right=0;
  while(left<old.length&&left<value.length&&old[left]===value[left])left++;
  while(right<old.length-left&&right<value.length-left&&old[old.length-1-right]===value[value.length-1-right])right++;
  if(old.length-left-right)text.delete(left,old.length-left-right);
  if(value.length-left-right)text.insert(left,value.slice(left,value.length-right));
}
function metadata(node) { const result = copy(node); for(const key of [...fields,'sharedVersion','sharedTextState','activeRun','activity','draftEpoch','messages','authorProfile']) delete result[key]; return result; }
function schedule() { clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),70); }
function keepRecovery(){try{localStorage.setItem('branch-unsynced-'+credentials.boardId,JSON.stringify({savedAt:new Date().toISOString(),state:host.getState()}));}catch{}}
function edit(node, field, value) {
  if (!ready || !writable || applying || !fields.includes(field)) return;
  const item=docs.get(node.id);
  if(item)item.doc.transact(()=>changeText(item.doc.getText(field),value),localOrigin);
  schedule();
}
function saveState(state) { if(ready&&writable&&!applying){for(const node of state.nodes)for(const field of fields)edit(node,field,String(node[field]||''));schedule();} }
async function flush() {
  clearTimeout(timer);
  if(!ready||!writable||applying)return;
  if(failure)throw failure;
  const state=copy(host.getState()); const previous=new Map((lastState?.nodes||[]).map(n=>[n.id,n]));
  const changes=[];
  for(const node of state.nodes){
    const old=previous.get(node.id);previous.delete(node.id);
    if(!old){changes.push({id:node.id,create:node});overlays.set(node.id,{create:node});}
    else {const patch={};for(const [key,value]of Object.entries(metadata(node)))if(!same(value,metadata(old)[key]))patch[key]=value;if(Object.keys(patch).length){changes.push({id:node.id,patch});overlays.set(node.id,{...(overlays.get(node.id)||{}),patch:{...overlays.get(node.id)?.patch,...patch}});}}
  }
  for(const key of previous.keys()){changes.push({id:key,remove:true});overlays.set(key,{remove:true});}
  const title=state.title!==lastState?.title?state.title:undefined;
  lastState=state;
  if(changes.length||title!==undefined){
    await enqueue(async()=>{
      await client.mutation('boards:patchNodes',args({changes,...(title!==undefined?{title}:{})}));
      for(const change of changes){
        if(change.create&&!docs.has(change.id)){
          // The server creates the canonical Yjs document. Do not independently seed it.
          const snapshot=await client.query('boards:read',args());receive(snapshot);
        }
        const overlay=overlays.get(change.id);
        if(same(overlay,change.remove?{remove:true}:change.create?{create:change.create}:{patch:change.patch}))overlays.delete(change.id);
      }
    });
  }
  const updates=[...pending.entries()];pending.clear();
  for(const [key,list]of updates){const item=docs.get(key);if(!item)continue;const update=Y.mergeUpdates(list);const epoch=item.epoch;
    await enqueue(async()=>{
      await focusTask;
      if (docs.get(key) !== item) return;
      const result = await client.mutation('collaboration:updateText',args({nodeKey:key,update:bytes(update),tabId,epoch}));
      if (result?.deleted) {
        keepRecovery();
        forgetDeletedNode(key);
        receive(await client.query('boards:read',args()));
      }
    });
  }
  await queue;
  if(failure)throw failure;
  status(connected?'Shared · saved':'Reconnecting · edits kept locally');updateLocks();
}
function fieldOf(el){return el?.matches?.('[data-prompt]')?'draft':el?.dataset?.edit;}
function selectionOffset(el){if(el instanceof HTMLTextAreaElement)return [el.selectionStart,el.selectionEnd];const selection=getSelection();if(!selection.rangeCount||!el.contains(selection.anchorNode)||!el.contains(selection.focusNode))return null;const range=document.createRange();range.selectNodeContents(el);range.setEnd(selection.anchorNode,selection.anchorOffset);const a=range.toString().length;range.selectNodeContents(el);range.setEnd(selection.focusNode,selection.focusOffset);return [a,range.toString().length];}
function caretSnapshot(){const el=document.activeElement,field=fieldOf(el),key=el?.closest?.('.card')?.dataset.node,item=docs.get(key);if(!item||!fields.includes(field))return null;const offsets=selectionOffset(el);if(!offsets)return null;return {key,field,positions:offsets.map(i=>Y.createRelativePositionFromTypeIndex(item.doc.getText(field),i))};}
function restoreCaret(saved){if(!saved)return;const item=docs.get(saved.key);if(!item)return;const el=document.querySelector(`[data-node="${saved.key}"] ${saved.field==='draft'?'[data-prompt]':`[data-edit="${saved.field}"]`}`);if(!el)return;const offsets=saved.positions.map(p=>Y.createAbsolutePositionFromRelativePosition(p,item.doc)?.index||0);el.focus({preventScroll:true});if(el instanceof HTMLTextAreaElement){el.setSelectionRange(...offsets);return;}const point=index=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let leaf,last;while(leaf=walker.nextNode()){last=leaf;if(index<=leaf.length)return [leaf,index];index-=leaf.length;}return last?[last,last.length]:[el,0];};getSelection().setBaseAndExtent(...point(offsets[0]),...point(offsets[1]));}
function receive(snapshot){
  if(!snapshot)return;writable=snapshot.role!=='viewer';document.body.classList.toggle('board-viewer',!writable);const caret=caretSnapshot();applying=true;
  try{
    const nodes=[];const seen=new Set();
    for(const remote of snapshot.nodes){
      seen.add(remote.id);const overlay=overlays.get(remote.id);if(overlay?.remove)continue;
      const item=makeDoc(remote.id,remote.sharedTextState,remote.draftEpoch||0);Y.applyUpdate(item.doc,new Uint8Array(remote.sharedTextState),'remote');item.epoch=remote.draftEpoch||0;
      const data={...remote,...overlay?.patch};delete data.sharedTextState;
      for(const field of fields)data[field]=item.doc.getText(field).toString();
      nodes.push(data);
    }
    for(const [key,overlay]of overlays)if(!seen.has(key)&&overlay.create)nodes.push(copy(overlay.create));
    // Retire deleted documents before undo can restore their canonical text.
    for (const key of docs.keys()) if (!seen.has(key) && !overlays.get(key)?.create) forgetDeletedNode(key);
    host.receive({title:snapshot.title,nodes});lastState=copy(host.getState());restoreCaret(caret);updateLocks();
  }finally{applying=false;}
}
function currentUserId(){return credentials?.userId||window.BranchAccount?.userId||rows.find(r=>r.tabId===tabId)?.userId;}
function nodeEditors(key,now=Date.now()){return rows.filter(r=>r.nodeKey===key&&r.expiresAt>now);}
function otherPersonEditing(key){const userId=currentUserId();return nodeEditors(key).some(r=>r.userId!==userId&&r.tabId!==tabId);}
function updateLocks(){
  updateUndoButton();
  if(!ready)return;const now=Date.now();const boardTitle=document.getElementById('board-title');if(boardTitle)boardTitle.contentEditable=writable&&connected&&!failure?'plaintext-only':'false';
  for(const node of host.getState().nodes){const el=document.querySelector(`[data-node="${node.id}"]`);if(!el)continue;
    const editors=nodeEditors(node.id,now);const self=active?.key===node.id;
    const people=new Map(editors.map(r=>[r.userId,r.name]));if(self)people.set(currentUserId()||tabId,people.get(currentUserId())||'You');
    const other=otherPersonEditing(node.id);
    const blocked=!writable||!connected||!!failure||other||sending.has(node.id)||!!node.activeRun;
    const button=el.querySelector('.send-message');if(button){button.disabled=!!blocked;button.removeAttribute('title');button.removeAttribute('data-tooltip');}
    for(const field of el.querySelectorAll('[data-prompt],[data-edit]')){if(field instanceof HTMLTextAreaElement)field.readOnly=!writable||!connected||!!failure;else field.contentEditable=writable&&connected&&!failure?'plaintext-only':'false';}
    el.classList.toggle('shared-editing',other);
    let badge=el.querySelector('.editing-presence');if(people.size){if(!badge){badge=document.createElement('span');badge.className='editing-presence';el.querySelector('.composer-controls')?.prepend(badge);}badge.replaceChildren(...[...people].map(([id,name])=>{const person=editors.find(r=>r.userId===id);const img=document.createElement('img');img.src=avatarURL(name,person?.color);img.alt=name;img.width=22;img.height=22;return img;}));badge.removeAttribute('title');badge.dataset.tooltip=[...people.values()].join(', ');badge.setAttribute('aria-label',badge.dataset.tooltip);}else badge?.remove();
  }
}
function focusEditor(el){const field=fieldOf(el),key=el?.closest?.('.card')?.dataset.node;if(!ready||!writable||!key||!fields.includes(field)||applying)return;if(active?.key===key&&active.field===field)return;const next={key,field,expiresAt:0};active=next;updateLocks();focusTask=focusTask.catch(()=>{}).then(async()=>{if(active!==next)return;if(!docs.has(key)){const current=host.getState().nodes.find(n=>n.id===key);if(!current){if(active===next)active=null;return;}const node=copy(current);await client.mutation('boards:patchNodes',args({changes:[{id:key,create:node}]}));receive(await client.query('boards:read',args()));}await client.mutation('collaboration:focus',args({nodeKey:key,field,tabId})).then(r=>{if(r.deleted){if(active===next)active=null;}else next.expiresAt=r.expiresAt;});}).catch(error=>{failure=error;host.notify(error.message);updateLocks();});}
async function blurEditor(el){if(applying||!active)return;const field=fieldOf(el),key=el?.closest?.('.card')?.dataset.node;if(active.key!==key||active.field!==field)return;const old=active;try{await flush();await focusTask;await client.mutation('collaboration:release',args({tabId,nodeKey:old.key,field:old.field}));if(active===old)active=null;updateLocks();}catch{updateLocks();}}
async function send(key){
  if(!ready||!writable||sending.has(key))return;sending.add(key);updateLocks();try{await flush();updateLocks();if(otherPersonEditing(key))return host.notify('Someone else is editing this node. Send when they finish.');if(!connected||failure)throw Error('Reconnect and sync before sending');sending.add(key);updateLocks();const snapshot=await client.query('boards:read',args());const node=snapshot.nodes.find(n=>n.id===key);if(!node)throw Error('Chat not found');const videoTranscripts=await host.prepareVideoTranscripts(node.contexts||[]);const localFiles=await prepareLocalFiles(node.contexts||[],snapshot.nodes,{cache:uploadedFiles,read:host.readLocalFile,upload:file=>window.BoardShared.uploadFile(file)});await client.mutation('chat:send',args({nodeKey:key,requestId:crypto.randomUUID(),expectedVersion:node.sharedVersion,localFiles,videoTranscripts}));}catch(error){host.notify(typeof error.data==='string'?error.data:error.message);}finally{sending.delete(key);updateLocks();}
}
// Explicit geometry writes survive subscriptions received during a group drag.
async function moveNodes(nodes){
 if(!ready||!writable)return;
 const changes=nodes.map(node=>({id:node.id,patch:{x:node.x,y:node.y}}));
 for(const change of changes)overlays.set(change.id,{...(overlays.get(change.id)||{}),patch:{...overlays.get(change.id)?.patch,...change.patch}});
 try{await enqueue(()=>client.mutation('boards:patchNodes',args({changes})));
  for(const change of changes){const overlay=overlays.get(change.id);if(!overlay?.patch)continue;for(const field of ['x','y'])if(overlay.patch[field]===change.patch[field])delete overlay.patch[field];if(!Object.keys(overlay.patch).length){delete overlay.patch;if(!Object.keys(overlay).length)overlays.delete(change.id);}}
 }catch(error){host.notify(error.message);}
}
window.BoardShared={connect:start,async disconnect(){await deletionQueue;if(ready&&writable&&!failure){try{await flush();await focusTask;await client.mutation('collaboration:release',args({tabId}));}catch{keepRecovery();}}ready=false;active=null;clearTimeout(timer);for(const off of subscriptions.splice(0))off();docs.clear();uploadedFiles.clear();pending.clear();overlays.clear();},get writable(){return writable;},headers(){return {'X-Board-Id':credentials?.boardId||'','X-Board-Token':credentials?.token||'',...(window.BranchAccount?.token?{Authorization:'Bearer '+window.BranchAccount.token}:{})};},get enabled(){return ready;},get applying(){return applying;},saveState,edit,send,deleteNode,moveNodes,async stop(key){try{await client.mutation('chat:stop',args({nodeKey:key}));}catch(error){host.notify(error.message);}},async uploadFile(file){
 const scope=args();const {ticket,url}=await client.mutation('files:uploadUrl',scope);
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
 if(!response.ok)throw Error('File upload failed');
 const {storageId}=await response.json();await client.mutation('files:finish',{...scope,ticket,storageId});return storageId;
},async fileURL(storageId){return (await client.query('files:read',args({storageId}))).url;},refreshLocks:updateLocks,undo(redo=false){const el=document.activeElement,item=docs.get(el?.closest?.('.card')?.dataset.node);if(item&&fields.includes(fieldOf(el))){(redo?item.undo.redo():item.undo.undo());const node=host.getState().nodes.find(n=>n.id===el.closest('.card').dataset.node);node[fieldOf(el)]=item.doc.getText(fieldOf(el)).toString();host.refreshText(node);schedule();}else return undoDeletion(redo);}};
document.addEventListener('keydown',e=>{if(ready&&(e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&fields.includes(fieldOf(e.target))){e.preventDefault();e.stopImmediatePropagation();window.BoardShared.undo(e.shiftKey);}},true);
document.addEventListener('focusin',e=>focusEditor(e.target));
document.addEventListener('focusout',e=>blurEditor(e.target));
setInterval(()=>{updateLocks();if(active&&connected){const current=active;focusTask=focusTask.catch(()=>{}).then(async()=>{if(active!==current)return;const result=await client.mutation('collaboration:focus',args({nodeKey:current.key,field:current.field,tabId}));if(result.deleted){if(active===current)active=null;}else current.expiresAt=result.expiresAt;}).catch(error=>{failure=error;updateLocks();});}},4000);
document.addEventListener('click',e=>{if(ready&&!writable&&e.target.closest('#cards,#chat-panel')&&!e.target.closest('[data-source-info],[data-context],[data-play-video],.resource,[data-media-credit],.collapse-card,.chat-preview-toggle,.open-chat-panel,[data-close-chat-panel]')){e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('submit',e=>{if(ready&&!writable&&e.target.closest('#cards,#chat-panel')){e.preventDefault();e.stopImmediatePropagation();}},true);
document.addEventListener('click',async e=>{const link=e.target.closest('a[href]');if(!ready||!link||e.defaultPrevented||e.metaKey||e.ctrlKey)return;const target=new URL(link.href,location.href);if(target.origin!==location.origin||target.pathname!=='/')return;e.preventDefault();await window.BoardShared.disconnect();location.assign(target.href);});
window.addEventListener('pagehide',()=>{if(ready)client.mutation('collaboration:release',args({tabId})).catch(()=>{});});

async function start(config){
  document.body.classList.add('shared-starting');status('Connecting shared board…');
  try{
    credentials=config;client=config.client||new ConvexClient(config.url);writable=config.role!=='viewer';
    const snapshot=await client.query('boards:read',args());receive(snapshot);ready=true;connected=client.connectionState().isWebSocketConnected;
    subscriptions.push(client.onUpdate('boards:read',args(),receive,error=>{failure=error;document.body.classList.add('shared-starting');status('Access changed · return to your boards');host.notify('Access to this board changed. Return to your boards.');updateLocks();}));
    subscriptions.push(client.onUpdate('collaboration:editors',args(),value=>{rows=value;updateLocks();},()=>{}));
    subscriptions.push(client.subscribeToConnectionState(state=>{connected=state.isWebSocketConnected;status(connected?'Shared · saved':'Reconnecting · Send paused');updateLocks();}));
    document.body.classList.remove('shared-starting');status('Shared · saved');updateLocks();focusEditor(document.activeElement);
    // URL bookkeeping must never prevent live subscriptions or leave the canvas locked.
    try{const url=new URL(location.href);if(url.searchParams.get('board')!==String(config.boardId)){url.searchParams.set('board',config.boardId);const browserHistory=window.history;browserHistory.replaceState.call(browserHistory,null,'',url.href);}}catch{}
  }catch(error){status('Shared setup unavailable');host.notify(error.message);}
}
