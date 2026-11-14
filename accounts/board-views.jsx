import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ContextCanvas } from './context-canvas';

const modes = [
  { id: 'visualization', title: 'Visualization', icon: 'git-branch', panel: 'board' },
  { id: 'context', title: 'Context', icon: 'chat-bubble', panel: 'board-context' },
];

export function BoardViews({ boardId, token }) {
  const [mode, setMode] = useState('visualization');
  const [selection, setSelection] = useState('');
  const [cards, setCards] = useState([]);
  const tabs = useRef({});
  const slot = document.getElementById('board-view-slot');
  const showingContext = mode === 'context';

  useEffect(() => {
    const openCard = event => {
      setSelection(event.detail.id);
      setMode('context');
      tabs.current.context?.focus({ preventScroll: true });
    };
    window.addEventListener('branch:show-context', openCard);
    window.dispatchEvent(new CustomEvent('branch:show-initial-context'));
    return () => window.removeEventListener('branch:show-context', openCard);
  }, []);

  useLayoutEffect(() => {
    const canvas = document.getElementById('board');
    canvas.setAttribute('role', 'tabpanel');
    canvas.setAttribute('aria-labelledby', 'visualization-tab');
    return () => {
      canvas.removeAttribute('role');
      canvas.removeAttribute('aria-labelledby');
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = document.getElementById('board');
    const setContextMode = active => {
      document.body.classList.toggle('board-context-mode', active);
      canvas.inert = active;
      window.dispatchEvent(new Event('branch:view-changed'));
    };
    setContextMode(showingContext);
    return () => { if (showingContext) setContextMode(false); };
  }, [showingContext]);

  useLayoutEffect(() => {
    if (!showingContext) return;
    const receive = () => {
      const next = window.BranchHost.getState().nodes
        .filter(node => node.chatgptSynced)
        .map(node => ({ id: node.id, title: node.title || 'Untitled card', owner: node.chatgptSyncOwner || '', latest: node.chatgptLatestUpdate || 0 }));
      setSelection(previous => next.some(card => card.id === previous) ? previous : next[0]?.id || '');
      setCards(previous => {
        const byId = new Map(next.map(card => [card.id, card]));
        const ordered = previous.flatMap(card => {
          const current = byId.get(card.id);
          byId.delete(card.id);
          return current ? [current] : [];
        }).concat([...byId.values()]);
        return previous.length === ordered.length && previous.every((card, index) =>
          card.id === ordered[index].id && card.title === ordered[index].title &&
          card.owner === ordered[index].owner && card.latest === ordered[index].latest) ? previous : ordered;
      });
    };
    window.addEventListener('branch:board-updated', receive);
    receive();
    return () => window.removeEventListener('branch:board-updated', receive);
  }, [showingContext]);

  function navigateTabs(event) {
    const keys = { ArrowLeft: mode === 'context' ? 'visualization' : 'context',
      ArrowRight: mode === 'context' ? 'visualization' : 'context', Home: 'visualization', End: 'context' };
    const next = keys[event.key];
    if (!next) return;
    event.preventDefault();
    tabs.current[next]?.focus();
    setMode(next);
  }

  return <>
    {createPortal(<div className="board-view-switch" role="tablist" aria-label="Board view" onKeyDown={navigateTabs}>
      {modes.map(view => <button key={view.id} id={view.id + '-tab'} ref={el => { tabs.current[view.id] = el; }}
        type="button" role="tab" aria-label={view.title} aria-selected={mode === view.id}
        aria-controls={view.panel} tabIndex={mode === view.id ? 0 : -1}
        data-tooltip={view.title} onClick={() => setMode(view.id)}
        dangerouslySetInnerHTML={{ __html: window.Iconoir[view.icon] }} />)}
    </div>, slot)}
    <main id="board-context" role="tabpanel" aria-labelledby="context-tab" tabIndex={0} hidden={!showingContext}>
      <ContextCanvas active={showingContext} boardId={boardId} token={token} cards={cards}
        selection={selection} onSelect={setSelection} />
    </main>
  </>;
}
