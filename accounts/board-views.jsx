import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ContextCanvas } from './context-canvas';
import { api, useQuery } from '../backend/react';

const modes = [
  { id: 'visualization', title: 'Canvas', icon: 'git-branch', panel: 'board' },
  { id: 'context', title: 'Context', icon: 'chat-bubble', panel: 'board-context' },
];

export function BoardViews({ boardId, token, canReview }) {
  const [mode, setMode] = useState('visualization');
  const [selection, setSelection] = useState('');
  const [cards, setCards] = useState([]);
  const tabs = useRef({});
  const previousDrafts = useRef(new Set());
  const slot = document.getElementById('board-view-slot');
  const showingContext = mode === 'context';
  const sources = useQuery(api.boardAgents.sources, showingContext ? { boardId, token } : 'skip');
  const agentCards = (sources || []).map(source => ({
    id: source.id, title: source.name, owner: source.owner, latest: source.latest, boardAgent: true,
  }));

  useEffect(() => {
    const openCard = event => {
      setSelection(event.detail.id);
      setMode('context');
      tabs.current.context?.focus({ preventScroll: true });
    };
    let frame;
    const openNote = event => {
      const key = event.detail;
      if (!window.BranchHost.getState().nodes.some(node => node.id === key)) {
        window.BranchHost.notify('This card is no longer on the canvas.');
        return;
      }
      setMode('visualization');
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('branch:show-coding-note', { detail: key }));
      });
    };
    window.addEventListener('branch:show-context', openCard);
    window.addEventListener('branch:open-coding-note', openNote);
    window.addEventListener('branch:open-board-card', openNote);
    window.dispatchEvent(new CustomEvent('branch:show-initial-context'));
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('branch:show-context', openCard);
      window.removeEventListener('branch:open-coding-note', openNote);
      window.removeEventListener('branch:open-board-card', openNote);
    };
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
    const receive = () => {
      const pending = window.BranchCoding?.pendingDrafts() || [];
      const draftsByCard = new Map(pending.map(row => [row.nodeKey, row.id]));
      const newDraft = [...pending].reverse().find(row => !previousDrafts.current.has(row.id));
      previousDrafts.current = new Set(pending.map(row => row.id));
      const nodes = window.BranchHost.getState().nodes;
      const notesBySource = new Map();
      for (const note of nodes) {
        if (!note.codingNote) continue;
        const sourceKey = note.codingNote.sourceKey;
        const notes = notesBySource.get(sourceKey) || [];
        notes.push({ id: note.id, title: note.title, result: note.body, handoffId: note.codingNote.handoffId, coding: true });
        notesBySource.set(sourceKey, notes);
      }
      const next = nodes
        .filter(node => node.chatgptSynced || node.codingResult?.text || draftsByCard.has(node.id) || notesBySource.has(node.id))
        .map(node => ({
          id: node.id, title: node.title || 'Untitled card',
          chatgpt: !!node.chatgptSynced, owner: node.chatgptSyncOwner || '', latest: node.chatgptLatestUpdate || 0,
          draftId: draftsByCard.get(node.id), codingResult: node.codingResult?.text ? node.codingResult : null,
          notes: notesBySource.get(node.id) || [],
        }));
      const sourceKeys = new Set(nodes.map(node => node.id));
      for (const [sourceKey, notes] of notesBySource) {
        if (!sourceKeys.has(sourceKey)) next.push({ id: sourceKey, title: 'Coding notes', notes });
      }
      setSelection(previous => {
        if (newDraft && next.some(card => card.id === newDraft.nodeKey)) return newDraft.nodeKey;
        return previous || next[0]?.id || '';
      });
      setCards(previous => {
        const byId = new Map(next.map(card => [card.id, card]));
        const ordered = previous.flatMap(card => {
          const current = byId.get(card.id);
          byId.delete(card.id);
          return current ? [current] : [];
        }).concat([...byId.values()]);
        return previous.length === ordered.length && previous.every((card, index) =>
          card.id === ordered[index].id && card.title === ordered[index].title &&
          card.chatgpt === ordered[index].chatgpt && card.owner === ordered[index].owner &&
          card.latest === ordered[index].latest && card.draftId === ordered[index].draftId &&
          card.codingResult?.handoffId === ordered[index].codingResult?.handoffId &&
          card.notes.length === ordered[index].notes.length && card.notes.every((note, noteIndex) => {
            const nextNote = ordered[index].notes[noteIndex];
            return note.id === nextNote.id && note.title === nextNote.title && note.result === nextNote.result;
          })) ? previous : ordered;
      });
    };
    window.addEventListener('branch:board-updated', receive);
    window.addEventListener('branch:coding-updated', receive);
    receive();
    return () => {
      window.removeEventListener('branch:board-updated', receive);
      window.removeEventListener('branch:coding-updated', receive);
    };
  }, [boardId]);

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
      <ContextCanvas active={showingContext} boardId={boardId} token={token} cards={[...cards, ...agentCards]}
        canReview={canReview} selection={selection} onSelect={setSelection} />
    </main>
  </>;
}
