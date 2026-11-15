import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePaginatedQuery, useMutation, api } from '../backend/react';

const stepX = 378;
const stepY = 174;
const cardWidth = 306;
const cardHeight = 130;
const shortDate = timestamp => new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const statusLabel = { active: 'Active', idle: 'Idle', done: 'Done', abandoned: 'Closed' };
const kindLabel = { decision: 'Decision', interface: 'Interface change', blocker: 'Blocker', progress: 'Progress', done: 'Done', landed: 'Landed on GitHub' };
const initialCamera = () => ({ x: 32, y: 145, z: Math.min(1, Math.max(.25, (innerWidth - 64) / cardWidth)) });

export function ContextCanvas({ active, boardId, token, cards: allCards, work, selection, onSelect }) {
  const surface = useRef(null);
  const gesture = useRef(null);
  const [camera, setCamera] = useState(initialCamera);
  const [openUpdate, setOpenUpdate] = useState('');
  const [area, setArea] = useState('');
  const endWork = useMutation(api.work.end), setWorkContext = useMutation(api.work.setContext);
  // "New" means newer than the last time this person left the Context view in this browser.
  const seenKey = 'branch-context-seen-' + boardId;
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    if (!active) return;
    try { setSeen(Number(localStorage.getItem(seenKey)) || 0); } catch {}
    return () => { try { localStorage.setItem(seenKey, String(Date.now())); } catch {} };
  }, [active, seenKey]);
  const areas = [...new Set(allCards.flatMap(card => card.areas))].sort();
  const filter = areas.includes(area) ? area : '';
  const cards = filter ? allCards.filter(card => card.areas.includes(filter)) : allCards;
  const digest = filter ? work?.digests.find(item => item.area === filter) : null;
  const selected = cards.find(card => card.id === selection) ?? cards[0];
  const row = cards.findIndex(card => card.id === selected?.id);
  const { results, status, loadMore } = usePaginatedQuery(selected?.kind === 'work' ? api.work.updates : api.chatgptSync.read,
    active && selected ? { boardId, token, nodeKey: selected.id } : 'skip', { initialNumItems: 10 });

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
      if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * .01), event.clientX, event.clientY);
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
      if (top >= 116 && top + cardHeight * previous.z <= window.innerHeight - 48 && previous.x >= 16 && previous.x < window.innerWidth - 100) return previous;
      return { ...previous, x: 32, y: 146 - row * stepY * previous.z };
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

  function revealFocused(event) {
    if (!event.target.matches(':focus-visible')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = rect.left < 16 ? 16 - rect.left : Math.min(0, innerWidth - 16 - rect.right);
    const y = rect.top < 120 ? 120 - rect.top : Math.min(0, innerHeight - 56 - rect.bottom);
    if (x || y) setCamera(previous => ({ ...previous, x: previous.x + x, y: previous.y + y }));
  }

  if (!active) return null;
  const update = results.find(item => item.id === openUpdate);
  const y = row * stepY;
  const wire = window.BranchHost.curve;
  const gridStep = 24 * camera.z;

  return <div ref={surface} className="context-canvas"
    style={{ '--context-grid': gridStep + 'px', backgroundPosition: camera.x + 'px ' + camera.y + 'px' }}
    onPointerDown={startPan} onPointerMove={movePan} onLostPointerCapture={stopPan}>
    {!allCards.length && <p className="context-canvas-empty">Plans and updates from coding agents and connected ChatGPT chats will appear here.</p>}
    {(areas.length > 0 || work?.canConfigure) && <div className="context-bar" onPointerDown={event => event.stopPropagation()}>
      {areas.length > 0 && <div className="context-areas" role="group" aria-label="Filter by project area">
        <button type="button" aria-pressed={!filter} onClick={() => setArea('')}>All</button>
        {areas.map(name => <button key={name} type="button" aria-pressed={filter === name} onClick={() => { setOpenUpdate(''); setArea(name); }}>{name}</button>)}
      </div>}
      {work?.canConfigure && <label className="context-setting" data-tooltip="Adds a short list of other people's active work to every chat sent on this board">
        <input type="checkbox" checked={work.workContext} onChange={event => setWorkContext({ boardId, token, enabled: event.target.checked }).catch(error => window.BranchHost.notify(error.message))} />
        <span>Tell chats about active work</span>
      </label>}
      {digest && <p className="context-digest">{digest.text}</p>}
    </div>}
    <div className="context-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})` }}>
      <svg className="context-wires" aria-hidden="true">
        {results.map((item, index) => {
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
        <span className="context-node-kind">{card.kind === 'work' ? statusLabel[card.status] || 'Active' : 'ChatGPT'} {card.owner ? '· ' + card.owner : ''}{seen > 0 && card.latest > seen && <i className="context-new" aria-label="New since your last visit" />}</span>
        <strong>{card.title}</strong>
        {card.latest > 0 && <time dateTime={new Date(card.latest).toISOString()}>{shortDate(card.latest)}</time>}
        {card.id === selected?.id && status === 'LoadingFirstPage' && <span role="status">Loading updates…</span>}
      </button>)}
      {results.map((item, index) => <button type="button" key={item.id} className="card context-node context-update" onFocus={revealFocused}
        style={{ left: (index + 1) * stepX, top: y, width: cardWidth }}
        aria-expanded={item.id === update?.id} onClick={() => setOpenUpdate(item.id === update?.id ? '' : item.id)}>
        <time dateTime={new Date(item.timestamp).toISOString()}>{shortDate(item.timestamp)}</time>
        <strong>{item.prompt || (item.kind ? (kindLabel[item.kind] || 'Update') + (item.source === 'github' ? ' · GitHub' : '') : 'Shared update')}</strong>
        <span className="context-update-excerpt">{item.result}</span>
      </button>)}
      {(status === 'CanLoadMore' || status === 'LoadingMore') && <button type="button" className="context-load a-secondary" onFocus={revealFocused} disabled={status === 'LoadingMore'}
        style={{ left: (results.length + 1) * stepX, top: y + 38 }} onClick={() => loadMore(10)}>{status === 'LoadingMore' ? 'Loading…' : 'Load older updates'}</button>}
    </div>
    {selected?.kind === 'work' && work?.items.find(item => item.nodeKey === selected.id)?.canEnd && <div className="context-actions" onPointerDown={event => event.stopPropagation()}>
      <button type="button" className="a-secondary" onClick={() => endWork({ boardId, token, nodeKey: selected.id, outcome: 'done' }).catch(error => window.BranchHost.notify(error.message))}>Mark done</button>
      <button type="button" className="a-text-button" onClick={() => endWork({ boardId, token, nodeKey: selected.id, outcome: 'abandoned' }).catch(error => window.BranchHost.notify(error.message))}>Close without finishing</button>
    </div>}
    {update && <article className="context-reader card" aria-label="Shared update">
      <header><time dateTime={new Date(update.timestamp).toISOString()}>{shortDate(update.timestamp)}</time>
        <button type="button" aria-label="Close update" onClick={() => setOpenUpdate('')}>×</button></header>
      {update.prompt && <p className="a-context-prompt">{update.prompt}</p>}
      {typeof window.BranchMarkdown === 'function'
        ? <div className="a-context-result" dangerouslySetInnerHTML={{ __html: window.BranchMarkdown(update.result) }} />
        : <p className="a-context-prompt">{update.result}</p>}
    </article>}
    {!!cards.length && <div className="context-zoom" role="group" aria-label="Context zoom">
      <button type="button" aria-label="Reset context view" data-tooltip="Reset view"
        onClick={() => {
          const reset = initialCamera();
          const selectedBottom = reset.y + (row * stepY + cardHeight) * reset.z;
          setCamera(selectedBottom < innerHeight - 48 ? reset : { ...reset, y: reset.y - row * stepY * reset.z });
        }} dangerouslySetInnerHTML={{ __html: window.Iconoir.expand }} />
      <button type="button" aria-label="Zoom context out" onClick={() => zoom(1 / 1.15, innerWidth / 2, innerHeight / 2)}>−</button>
      <span>{Math.round(camera.z * 100)}%</span>
      <button type="button" aria-label="Zoom context in" onClick={() => zoom(1.15, innerWidth / 2, innerHeight / 2)}>+</button>
    </div>}
  </div>;
}
