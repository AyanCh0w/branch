import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, useMutation, useQuery } from '../backend/react';

const stepX = 378;
const stepY = 174;
const cardWidth = 306;
const cardHeight = 130;
const shortDate = timestamp => new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const icon = name => ({ __html: window.Iconoir?.[name] || '' });
const kindLabel = { decision: 'Decision', finding: 'Finding', question: 'Open question', risk: 'Risk', note: 'Note' };
const statusLabel = { pending: 'To do', working: 'In progress', done: 'Done', blocked: 'Blocked' };
const sourceIcon = { website: 'link', video: 'youtube', file: 'attachment', github: 'github' };

// The board's plan, laid out the same way as on the Canvas, with what stands behind
// each part attached to it: the reasoning, the sources, and every entry agents wrote.
function useBoardNodes(active) {
  const current = () => window.BranchHost?.getState?.().nodes || [];
  const [nodes, setNodes] = useState(current);
  useEffect(() => {
    if (!active) return;
    const read = () => setNodes([...current()]);
    window.addEventListener('branch:board-updated', read);
    read();
    return () => window.removeEventListener('branch:board-updated', read);
  }, [active]);
  return nodes;
}

function Documents({ docs, onOpen }) {
  if (!docs.length) return <p className="cx-none">Nothing attached yet</p>;
  return <ul className="cx-docs">{docs.map(doc => <li key={doc.key}>
    {doc.href
      ? <a className="cx-doc" href={doc.href} target="_blank" rel="noopener noreferrer"><span dangerouslySetInnerHTML={icon(doc.icon)} /><span className="cx-doc-label">{doc.label}</span>{doc.meta && <small>{doc.meta}</small>}</a>
      : <button type="button" className="cx-doc" onClick={() => onOpen(doc)}><span dangerouslySetInnerHTML={icon(doc.icon)} /><span className="cx-doc-label">{doc.label}</span>{doc.meta && <small>{doc.meta}</small>}</button>}
  </li>)}</ul>;
}

function StructuredContext({ nodes, entries, onOpen, measure }) {
  const plan = nodes.find(node => node.visualPlan && node.plan?.format === 2 && node.body === node.planBody);
  const box = useRef(null);
  useLayoutEffect(() => {
    if (!box.current) { measure(0); return; }
    const observer = new ResizeObserver(() => measure(box.current ? box.current.offsetHeight : 0));
    observer.observe(box.current);
    measure(box.current.offsetHeight);
    return () => observer.disconnect();
  }, [!!plan]);
  if (!plan) return null;
  const known = new Set(nodes.map(node => node.id));
  const byNode = new Map();
  for (const entry of entries) {
    const key = entry.nodeKey && known.has(entry.nodeKey) ? entry.nodeKey : '';
    byNode.set(key, [...(byNode.get(key) || []), entry]);
  }
  const entryDocs = key => (byNode.get(key) || []).map(entry => ({
    key: 'entry-' + entry.id, icon: 'chat-bubble', label: entry.title, meta: `${entry.author} · ${shortDate(entry.timestamp)}`,
    title: entry.title, body: entry.result, nodeKey: entry.nodeKey,
  }));
  const sourceDocs = (owner, sources) => (sources || []).filter(item => item && typeof item === 'object').map((item, index) => ({
    key: owner + '-source-' + index, icon: sourceIcon[item.kind] || 'link', label: item.title, meta: item.note || '',
    ...(/^https?:\/\//.test(item.url || '') ? { href: item.url } : { title: item.title, body: item.text ? '```\n' + item.text + '\n```' : item.note || item.title }),
  }));
  const cardDocs = card => [
    ...(card.brief.detail ? [{ key: card.id + '-why', icon: 'page', label: 'Reasoning', meta: card.brief.by || '', title: card.title + ': reasoning', body: card.brief.detail, nodeKey: card.id }] : []),
    ...sourceDocs(card.id, card.brief.sources),
    ...entryDocs(card.id),
    ...(card.brief.history?.length ? [{
      key: card.id + '-versions', icon: 'refresh', label: `${card.brief.history.length} earlier version${card.brief.history.length === 1 ? '' : 's'}`, meta: '',
      title: card.title + ': earlier versions', nodeKey: card.id,
      body: card.brief.history.map(version => `**${version.by}** · ${shortDate(version.at)}\n\n${version.title}: ${version.summary}`).join('\n\n---\n\n'),
    }] : []),
  ];
  const live = plan.plan.steps.filter(step => !step.archived);
  const cards = nodes.filter(node => node.brief && !node.visualPlan && node.lane?.plan === plan.id);
  const under = id => cards.filter(card => (live.some(step => step.id === card.brief.step) ? card.brief.step : '') === id);
  const columns = [...live.map((step, index) => ({ id: step.id, label: `Step ${index + 1} · ${statusLabel[step.status]}`, title: step.title, sources: step.sources })),
    ...(under('').length ? [{ id: '', label: 'No step yet', title: 'Unsorted' }] : [])];
  const loose = (byNode.get('') || []);
  const research = loose.filter(entry => entry.title.startsWith('Research:')), other = loose.filter(entry => !entry.title.startsWith('Research:'));
  const asDocs = list => list.map(entry => ({ key: 'entry-' + entry.id, icon: 'chat-bubble', label: entry.title, meta: `${entry.author} · ${shortDate(entry.timestamp)}`, title: entry.title, body: entry.result }));
  return <div className="cx-structure" ref={box}>
    <section className="cx-plan card">
      <span className="cx-eyebrow">Plan</span><strong>{plan.title}</strong><p>{plan.plan.goal}</p>
      <h4>Plan changes</h4><Documents docs={entryDocs(plan.id)} onOpen={onOpen} />
      {!!research.length && <><h4>Research</h4><Documents docs={asDocs(research)} onOpen={onOpen} /></>}
      {!!other.length && <><h4>Other updates</h4><Documents docs={asDocs(other)} onOpen={onOpen} /></>}
      {!!plan.plan.sources?.length && <><h4>Sources</h4><Documents docs={sourceDocs(plan.id, plan.plan.sources)} onOpen={onOpen} /></>}
    </section>
    <div className="cx-steps">{columns.map(column => <section key={column.id || 'unsorted'} className="cx-step">
      <header className="card"><span className="cx-eyebrow">{column.label}</span><strong>{column.title}</strong>
        {!!column.sources?.length && <Documents docs={sourceDocs(plan.id + column.id, column.sources)} onOpen={onOpen} />}</header>
      {under(column.id).map(card => <article key={card.id} className={'cx-card card' + (card.brief.closed ? ' closed' : '')} data-brief-kind={card.brief.kind}>
        <span className="brief-chip">{kindLabel[card.brief.kind] || 'Note'}{card.brief.closed ? ' · closed' : ''}</span>
        <strong>{card.title}</strong><p>{card.body === card.brief.text ? card.brief.summary : card.body}</p>
        <Documents docs={cardDocs(card)} onOpen={onOpen} />
      </article>)}
      {!under(column.id).length && <p className="cx-none">No cards under this step</p>}
    </section>)}</div>
  </div>;
}

const initialCamera = () => ({ x: 32, y: 48, z: Math.min(.8, Math.max(.25, (innerWidth - 64) / cardWidth)) });

export function ContextCanvas({ active, boardId, token, cards, selection, onSelect, canReview, focus }) {
  const surface = useRef(null);
  const gesture = useRef(null);
  const [camera, setCamera] = useState(initialCamera);
  const [openUpdate, setOpenUpdate] = useState('');
  const [doc, setDoc] = useState(null);
  const [offset, setOffset] = useState(0);
  const nodes = useBoardNodes(active);
  const map = useQuery(api.boardAgents.contextMap, active ? { boardId, token } : 'skip');
  const selected = cards.find(card => card.id === selection) ?? cards[0];
  const row = cards.findIndex(card => card.id === selected?.id);
  const [page, setPage] = useState({ card: '', size: 10 });
  const limit = page.card === selected?.id ? page.size : 10;
  const timeline = useQuery(api.agentContext.read,
    active && selected?.chatgpt ? { boardId, token, nodeKey: selected.id, limit } : 'skip');
  const agentTimeline = useQuery(api.boardAgents.activity,
    active && selected?.boardAgent ? { boardId, token, connectionId: selected.id, limit } : 'skip');
  const activity = selected?.boardAgent ? agentTimeline : timeline;
  const results = activity?.items || [];
  // Arriving from a canvas card opens the update that explains it.
  const focused = focus ? results.find(item => item.nodeKey === focus)?.id : '';
  useEffect(() => { if (active && focused) setOpenUpdate(focused); }, [active, focus, focused]);

  function zoom(factor, x, y) {
    setCamera(previous => {
      const z = Math.min(1.5, Math.max(.25, previous.z * factor));
      const scale = z / previous.z;
      return { x: x - (x - previous.x) * scale, y: y - (y - previous.y) * scale, z };
    });
  }

  useEffect(() => {
    if (!active) return;
    const el = surface.current;
    const wheel = event => {
      if (event.target.closest('.context-reader')) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const bounds = el.getBoundingClientRect();
        zoom(Math.exp(-event.deltaY * .01), event.clientX - bounds.left, event.clientY - bounds.top);
      }
      else setCamera(previous => ({ ...previous, x: previous.x - event.deltaX, y: previous.y - event.deltaY }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [active]);

  // A card link can open a conversation below or outside the current camera.
  useLayoutEffect(() => {
    if (!active || !selection || row < 0) return;
    setCamera(previous => {
      const top = previous.y + row * stepY * previous.z;
      if (top >= 16 && top + cardHeight * previous.z <= surface.current.clientHeight - 48 && previous.x >= 16 && previous.x < surface.current.clientWidth - 100) return previous;
      return { ...previous, x: 32, y: 48 - row * stepY * previous.z };
    });
  }, [active, selection, row]);

  function startPan(event) {
    if (event.button !== 0 || event.target.closest('button, a, .context-reader')) return;
    gesture.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    surface.current.setPointerCapture(event.pointerId);
    surface.current.classList.add('panning-context');
  }

  function movePan(event) {
    const start = gesture.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    gesture.current = { ...start, x: event.clientX, y: event.clientY };
    setCamera(previous => ({ ...previous, x: previous.x + dx, y: previous.y + dy }));
  }

  function stopPan() {
    gesture.current = null;
    surface.current.classList.remove('panning-context');
  }

  function zoomCenter(factor) {
    zoom(factor, surface.current.clientWidth / 2, surface.current.clientHeight / 2);
  }

  function revealFocused(event) {
    if (!event.target.matches(':focus-visible')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left < 16 ? 16 - rect.left : Math.min(0, innerWidth - 16 - rect.right);
    const top = surface.current.getBoundingClientRect().top + 16;
    const y = rect.top < top ? top - rect.top : Math.min(0, innerHeight - 56 - rect.bottom);
    if (x || y) setCamera(previous => ({ ...previous, x: previous.x + x, y: previous.y + y }));
  }

  if (!active) return null;
  const items = selected?.chatgpt || selected?.boardAgent ? results : [
    ...(selected?.draftId && selected.draftId !== selected.codingResult?.handoffId
      && !selected.notes.some(note => note.handoffId === selected.draftId)
      ? [{ id: selected.draftId, privateDraft: true }] : []),
    ...(selected?.notes || []),
    ...(selected?.codingResult ? [{
      id: selected.codingResult.handoffId, result: selected.codingResult.text, coding: true,
    }] : []),
  ];
  const update = items.find(item => item.id === openUpdate && !item.privateDraft);
  const y = row * stepY;
  // Agent timelines sit below the structured view.
  const rowsTop = offset ? offset + 90 : 0;
  const wire = window.BranchHost.curve;
  const gridStep = 24 * camera.z;

  return <div ref={surface} className="context-canvas"
    style={{ '--context-grid': gridStep + 'px', backgroundPosition: camera.x + 'px ' + camera.y + 'px' }}
    onPointerDown={startPan} onPointerMove={movePan} onLostPointerCapture={stopPan}>
    {!cards.length && !offset && <p className="context-canvas-empty">Updates from board agents, synced conversations and coding handoffs appear here.</p>}
    <div className="context-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})` }}>
      <StructuredContext nodes={nodes} entries={map?.items || []} measure={setOffset} onOpen={next => { setOpenUpdate(''); setDoc(next); }} />
      <div className="cx-rows" style={{ top: rowsTop }}>
      {!!rowsTop && !!cards.length && <h3 className="cx-rows-title">Activity by agent</h3>}
      <svg className="context-wires" aria-hidden="true">
        {items.map((item, index) => {
          const start = { x: cardWidth + index * stepX, y: y + 65 };
          const end = { x: (index + 1) * stepX, y: y + 65 };
          return <g key={item.id}>
            <path d={wire(start, end)} />
            <circle cx={start.x} cy={start.y} r="3" />
            <circle cx={end.x} cy={end.y} r="3" />
          </g>;
        })}
      </svg>
      {cards.map((card, index) => <button key={card.id} type="button"
        className="card context-node context-source" onFocus={revealFocused} aria-pressed={card.id === selected?.id}
        style={{ left: 0, top: index * stepY, width: cardWidth }}
        onClick={() => { setOpenUpdate(''); onSelect(card.id); }}>
        <span className="context-node-kind">{card.chatgpt ? 'ChatGPT' : card.boardAgent ? 'Board agent' : 'Coding agent'}{card.owner ? ' · ' + card.owner : ''}</span>
        <strong>{card.title}</strong>
        {card.latest > 0 && <time dateTime={new Date(card.latest).toISOString()}>{shortDate(card.latest)}</time>}
        {card.draftId && <span className="context-node-kind">Private draft ready</span>}
        {(card.chatgpt || card.boardAgent) && card.id === selected?.id && !activity && <span role="status">Loading updates…</span>}
      </button>)}
      {items.map((item, index) => <button type="button" key={item.id} className="card context-node context-update" onFocus={revealFocused}
        style={{ left: (index + 1) * stepX, top: y, width: cardWidth }}
        aria-haspopup={item.privateDraft ? 'dialog' : undefined}
        aria-expanded={item.privateDraft ? undefined : item.id === update?.id}
        onClick={() => {
          if (item.privateDraft) window.BranchCoding?.open(selected.id);
          else { setDoc(null); setOpenUpdate(item.id === update?.id ? '' : item.id); }
        }}>
        {item.timestamp && <time dateTime={new Date(item.timestamp).toISOString()}>{shortDate(item.timestamp)}</time>}
        <strong>{item.privateDraft ? 'Review draft' : item.coding ? item.title || 'Published coding result' : item.title || item.prompt || 'Shared update'}</strong>
        <span className="context-update-excerpt">{item.privateDraft ? 'Only visible to you' : item.result}</span>
      </button>)}
      {activity?.hasMore && limit < 200 && <button type="button" className="context-load a-secondary" onFocus={revealFocused}
        style={{ left: (results.length + 1) * stepX, top: y + 38 }} onClick={() => setPage({ card: selected.id, size: limit + 10 })}>Load older updates</button>}
      </div>
    </div>
    {doc && !update && <article className="context-reader card" aria-label={doc.title}>
      <header><strong>{doc.title}</strong><button type="button" aria-label="Close" onClick={() => setDoc(null)}>×</button></header>
      {doc.meta && <p className="a-muted">{doc.meta}</p>}
      <div className="a-context-result" data-message-text dangerouslySetInnerHTML={{ __html: window.BranchHost.formatCodingResult(doc.body || '') }} />
      {doc.nodeKey && <button type="button" className="a-secondary"
        onClick={() => window.dispatchEvent(new CustomEvent('branch:open-board-card', { detail: doc.nodeKey }))}>Open card on canvas</button>}
    </article>}
    {update && <article className="context-reader card" aria-label={update.coding ? 'Published coding result' : 'Shared update'}>
      <header>{update.coding ? <strong>Published coding result</strong> : <time dateTime={new Date(update.timestamp).toISOString()}>{shortDate(update.timestamp)}</time>}
        <button type="button" aria-label="Close update" onClick={() => setOpenUpdate('')}>×</button></header>
      {selected?.boardAgent && <p className="a-muted">{update.author}</p>}
      {update.prompt && <p className="a-context-prompt">{update.prompt}</p>}
      {update.coding && update.title && <button type="button" className="a-secondary"
        onClick={() => window.dispatchEvent(new CustomEvent('branch:open-coding-note', { detail: update.id }))}>Open note on canvas</button>}
      <div className="a-context-result" data-message-text dangerouslySetInnerHTML={{
        __html: window.BranchHost.formatCodingResult(update.result),
      }} />
      {selected?.boardAgent && update.nodeKey && <button type="button" className="a-secondary"
        onClick={() => window.dispatchEvent(new CustomEvent('branch:open-board-card', { detail: update.nodeKey }))}>Open card on canvas</button>}
      {update.proposal && <AgentProposal key={update.id} boardId={boardId} token={token} update={update} canReview={canReview} />}
    </article>}
    {!!cards.length && <div className="context-zoom" role="group" aria-label="Context zoom">
      <button type="button" aria-label="Reset context view" data-tooltip="Reset view"
        onClick={() => {
          const reset = initialCamera();
          const selectedBottom = reset.y + (row * stepY + cardHeight) * reset.z;
          setCamera(selectedBottom < surface.current.clientHeight - 48 ? reset : { ...reset, y: reset.y - row * stepY * reset.z });
        }} dangerouslySetInnerHTML={{ __html: window.Iconoir.expand }} />
      <button type="button" aria-label="Zoom context out" onClick={() => zoomCenter(1 / 1.15)}>−</button>
      <span>{Math.round(camera.z * 100)}%</span>
      <button type="button" aria-label="Zoom context in" onClick={() => zoomCenter(1.15)}>+</button>
    </div>}
  </div>;
}

function AgentProposal({ boardId, token, update, canReview }) {
  const review = useMutation(api.boardAgents.review);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState('');
  const status = update.proposal.status === 'pending' ? decision || 'pending' : update.proposal.status;

  async function resolve(apply) {
    setBusy(true);
    setError('');
    try {
      const result = await review({ boardId, token, updateId: update.id, apply });
      setDecision(result.status);
    } catch (error) {
      setError(error.message || 'Could not review the proposal.');
    } finally { setBusy(false); }
  }

  return <section className="a-agent-section" aria-label="Proposed card changes">
    <p className="a-muted">Replacement title and note</p>
    <strong>{update.proposal.title}</strong>
    <div className="a-context-result" dangerouslySetInnerHTML={{
      __html: window.BranchHost.formatCodingResult(update.proposal.body),
    }} />
    {status === 'pending' && canReview && <div className="a-agent-actions">
      <button type="button" className="a-primary" disabled={busy} onClick={() => resolve(true)}>Apply edit</button>
      <button type="button" className="a-secondary" disabled={busy} onClick={() => resolve(false)}>Dismiss</button>
    </div>}
    {status !== 'pending' && <p role="status">{status === 'applied' ? 'Edit applied.' : 'Proposal dismissed.'}</p>}
    {error && <p className="a-error" role="alert">{error}</p>}
  </section>;
}
