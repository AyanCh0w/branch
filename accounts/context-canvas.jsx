import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, useQuery } from '../backend/react';

const stepX = 378;
const stepY = 174;
const cardWidth = 306;
const cardHeight = 130;
const shortDate = timestamp => new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const initialCamera = () => ({ x: 32, y: 48, z: Math.min(1, Math.max(.25, (innerWidth - 64) / cardWidth)) });

export function ContextCanvas({ active, boardId, token, cards, selection, onSelect }) {
  const surface = useRef(null);
  const gesture = useRef(null);
  const [camera, setCamera] = useState(initialCamera);
  const [openUpdate, setOpenUpdate] = useState('');
  const selected = cards.find(card => card.id === selection) ?? cards[0];
  const row = cards.findIndex(card => card.id === selected?.id);
  const [page, setPage] = useState({ card: '', size: 10 });
  const limit = page.card === selected?.id ? page.size : 10;
  const timeline = useQuery(api.agentContext.read,
    active && selected?.chatgpt ? { boardId, token, nodeKey: selected.id, limit } : 'skip');
  const results = timeline?.items || [];

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
  const items = selected?.chatgpt ? results : [
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
  const wire = window.BranchHost.curve;
  const gridStep = 24 * camera.z;

  return <div ref={surface} className="context-canvas"
    style={{ '--context-grid': gridStep + 'px', backgroundPosition: camera.x + 'px ' + camera.y + 'px' }}
    onPointerDown={startPan} onPointerMove={movePan} onLostPointerCapture={stopPan}>
    {!cards.length && <p className="context-canvas-empty">Coding drafts and updates from connected ChatGPT chats appear here.</p>}
    <div className="context-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})` }}>
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
        <span className="context-node-kind">{card.chatgpt ? 'ChatGPT' : 'Coding agent'}{card.owner ? ' · ' + card.owner : ''}</span>
        <strong>{card.title}</strong>
        {card.latest > 0 && <time dateTime={new Date(card.latest).toISOString()}>{shortDate(card.latest)}</time>}
        {card.draftId && <span className="context-node-kind">Private draft ready</span>}
        {card.chatgpt && card.id === selected?.id && !timeline && <span role="status">Loading updates…</span>}
      </button>)}
      {items.map((item, index) => <button type="button" key={item.id} className="card context-node context-update" onFocus={revealFocused}
        style={{ left: (index + 1) * stepX, top: y, width: cardWidth }}
        aria-haspopup={item.privateDraft ? 'dialog' : undefined}
        aria-expanded={item.privateDraft ? undefined : item.id === update?.id}
        onClick={() => {
          if (item.privateDraft) window.BranchCoding?.open(selected.id);
          else setOpenUpdate(item.id === update?.id ? '' : item.id);
        }}>
        {item.timestamp && <time dateTime={new Date(item.timestamp).toISOString()}>{shortDate(item.timestamp)}</time>}
        <strong>{item.privateDraft ? 'Review draft' : item.coding ? item.title || 'Published coding result' : item.prompt || 'Shared update'}</strong>
        <span className="context-update-excerpt">{item.privateDraft ? 'Only visible to you' : item.result}</span>
      </button>)}
      {timeline?.hasMore && <button type="button" className="context-load a-secondary" onFocus={revealFocused}
        style={{ left: (results.length + 1) * stepX, top: y + 38 }} onClick={() => setPage({ card: selected.id, size: limit + 10 })}>Load older updates</button>}
    </div>
    {update && <article className="context-reader card" aria-label={update.coding ? 'Published coding result' : 'Shared update'}>
      <header>{update.coding ? <strong>Published coding result</strong> : <time dateTime={new Date(update.timestamp).toISOString()}>{shortDate(update.timestamp)}</time>}
        <button type="button" aria-label="Close update" onClick={() => setOpenUpdate('')}>×</button></header>
      {update.prompt && <p className="a-context-prompt">{update.prompt}</p>}
      {update.coding && update.title && <button type="button" className="a-secondary"
        onClick={() => window.dispatchEvent(new CustomEvent('branch:open-coding-note', { detail: update.id }))}>Open note on canvas</button>}
      <div className="a-context-result" data-message-text dangerouslySetInnerHTML={{
        __html: window.BranchHost.formatCodingResult(update.result),
      }} />
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
