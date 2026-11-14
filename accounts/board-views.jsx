import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePaginatedQuery } from 'convex/react';
import { api } from '../convex/_generated/api';

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
        .map(node => ({ id: node.id, title: node.title || 'Untitled card' }))
        .sort((a, b) => a.title.localeCompare(b.title));
      setCards(previous => previous.length === next.length && previous.every((card, index) =>
        card.id === next[index].id && card.title === next[index].title) ? previous : next);
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

  const card = cards.find(candidate => candidate.id === selection) ?? cards[0];

  return <>
    {createPortal(<div className="board-view-switch" role="tablist" aria-label="Board view" onKeyDown={navigateTabs}>
      {modes.map(view => <button key={view.id} id={view.id + '-tab'} ref={el => { tabs.current[view.id] = el; }}
        type="button" role="tab" aria-label={view.title} aria-selected={mode === view.id}
        aria-controls={view.panel} tabIndex={mode === view.id ? 0 : -1}
        data-tooltip={view.title} onClick={() => setMode(view.id)}
        dangerouslySetInnerHTML={{ __html: window.Iconoir[view.icon] }} />)}
    </div>, slot)}
    <main id="board-context" role="tabpanel" aria-labelledby="context-tab" tabIndex={0} hidden={!showingContext}>
      {showingContext && <div className="board-context-content">
        <h1>Shared context</h1>
        {card ? <>
          {cards.length > 1
            ? <label className="board-context-picker">Conversation
              <select value={card.id} onChange={event => setSelection(event.target.value)}>
                {cards.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
            : <h2>{card.title}</h2>}
          <ContextUpdates key={card.id} boardId={boardId} token={token} nodeKey={card.id} />
        </> : <p className="board-context-empty">Updates from connected ChatGPT chats will appear here.</p>}
      </div>}
    </main>
  </>;
}

function ContextUpdates({ boardId, token, nodeKey }) {
  const { results, status, loadMore } = usePaginatedQuery(api.chatgptSync.read,
    { boardId, token, nodeKey }, { initialNumItems: 10 });
  return <>
    {status === 'LoadingFirstPage' && <p role="status">Loading updates…</p>}
    <ol className="a-context-updates">
      {results.map(update => <li key={update.id}>
        <time dateTime={new Date(update.timestamp).toISOString()}>{new Date(update.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</time>
        {update.prompt && <p className="a-context-prompt">{update.prompt}</p>}
        {typeof window.BranchMarkdown === 'function'
          ? <div className="a-context-result" dangerouslySetInnerHTML={{ __html: window.BranchMarkdown(update.result) }} />
          : <p className="a-context-prompt">{update.result}</p>}
      </li>)}
    </ol>
    {(status === 'CanLoadMore' || status === 'LoadingMore') &&
      <button className="a-secondary" disabled={status === 'LoadingMore'} onClick={() => loadMore(10)}>Load older updates</button>}
  </>;
}
