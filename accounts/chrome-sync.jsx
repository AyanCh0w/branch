import React, { useState } from 'react';
import {handoff,appURL} from '../app/desktop-setup';
import { api, useMutation, useQuery } from '../backend/react';
import { isChromeSyncOrigin } from '../collaboration/chrome-sync.cjs';

export const chromeSyncAvailable = isChromeSyncOrigin(location.origin);
export const desktopSyncAvailable = chromeSyncAvailable && location.protocol === 'https:';

export function ChromeSyncSettings({ boardId, Dialog, onClose, onConnectMac }) {
  const count = useQuery(api.chatgptBrowser.count, { boardId });
  const disconnect = useMutation(api.chatgptBrowser.disconnectBoard);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [launching, setLaunching] = useState(false);
  return <Dialog title="ChatGPT sync" onClose={onClose}>
    <p>New replies from the chat you choose will appear in this board’s Context. Anyone with access to the board can read them.</p>
    {desktopSyncAvailable && <p><button type="button" className="a-primary" disabled={launching} onClick={async()=>{
      setLaunching(true);
      try {
        await onConnectMac();
        setStatus('Continue in Branch for Mac.');
      } catch {
        setStatus('Could not open Branch for Mac. Check your connection and try again.');
      } finally { setLaunching(false); }
    }}>{launching ? 'Opening Branch for Mac…' : 'Connect ChatGPT to this board'}</button></p>}
    {desktopSyncAvailable && <p className="a-muted">If Branch for Mac didn’t open, use the installation guide.</p>}
    <button type="button" className="a-primary" onClick={async()=>{try{await navigator.clipboard.writeText(handoff(boardId));setStatus('Setup instructions copied. Paste them into the ChatGPT conversation you want to connect.');}catch{setStatus('Clipboard unavailable. Open the installation guide for setup steps.');}}}>Copy setup instructions</button>
    <p><a href={'/mac-setup.html?board='+encodeURIComponent(boardId)} target="_blank" rel="noopener noreferrer">Installation guide ↗</a></p>
    <p className="a-muted">First-time setup requires macOS Accessibility approval. Only the chat you choose is shared.</p>
    {!!count && <button type="button" className="a-secondary" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        await disconnect({ boardId });
        setStatus('Disconnected your ChatGPT chats from this board.');
      } catch {
        setStatus('Could not disconnect. Try again.');
      } finally {
        setBusy(false);
      }
    }}>Disconnect ChatGPT chats ({count})</button>}
    <p role="status">{status}</p>
  </Dialog>;
}

const chromeCallback = 'https://lgbhkehiipjkjhpdkkmakodccahllneh.chromiumapp.org/branch';

export function ConnectChatGPTSync({ request, desktop = false }) {
  const boards = useQuery(api.library.list, {});
  const connect = useMutation(api.chatgptBrowser.connect);
  const connectDesktop = useMutation(api.chatgptBrowser.connectDesktop);
  const [boardId, setBoardId] = useState(desktop ? request.get('board') || '' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  const editable = boards?.filter(board => board.role !== 'viewer');
  const selected = editable?.find(board => board.id === boardId) || (editable?.length === 1 ? editable[0] : null);
  const state = request.get('state') || '';
  const conversationId = request.get('conversation') || '';
  const keyHash = request.get('challenge') || '';
  const valid = /^[0-9a-f]{64}$/.test(conversationId)
    && (desktop ? /^[0-9a-f]{64}$/.test(keyHash) : /^[0-9a-f-]{36}$/.test(state));
  const finish = fields => location.replace(chromeCallback + '#' + new URLSearchParams({ state, ...fields }));

  return <main className="a-link-landing a-chatgpt-consent">
    <h1>{desktop ? 'Connect ChatGPT on Mac' : 'Sync this ChatGPT conversation'}</h1>
    <p>New replies will save to the board you choose. Anyone with access to that board can read them.</p>
    {completed ? <><p role="status">Board approved. Return to Branch for Mac and wait until the app shows it is connected and syncing, then send a new message in ChatGPT.</p>
      <p><a className="a-primary" href={appURL()}>Return to Branch for Mac ↗</a></p><a href={'/app?board='+encodeURIComponent(selected?.id || '')}>Open this board ↗</a></> : valid ? <form onSubmit={async event => {
      event.preventDefault();
      if (busy || !selected) return;
      setBusy(true);
      setError('');
      try {
        if (desktop) {
          await connectDesktop({ boardId: selected.id, conversationId, keyHash });
          setCompleted(true);
          return;
        }
        const linked = await connect({ boardId: selected.id, conversationId });
        finish({ key: linked.key, board: linked.boardId, title: linked.boardTitle });
      } catch {
        setError('Could not connect to this board. Check that you can edit it and try again.');
        setBusy(false);
      }
    }}>
      <label className="a-field">Board
        <select value={selected?.id || ''} onChange={event => setBoardId(event.target.value)} disabled={busy || !editable?.length} required>
          <option value="">{boards ? 'Choose a board' : 'Loading boards…'}</option>
          {editable?.map(board => <option key={board.id} value={board.id}>{board.teamName ? board.teamName + ' / ' : ''}{board.title}</option>)}
        </select>
      </label>
      {editable?.length === 0 && <p><a href="/app" target="_blank" rel="noopener noreferrer">Create a board</a> to turn on sync.</p>}
      {error && <p className="a-error" role="alert">{error}</p>}
      <button className="a-primary" disabled={!selected || busy}>{busy ? 'Approving…' : desktop ? 'Approve this board' : 'Start syncing'}</button>
      <button type="button" className="a-secondary" onClick={() => desktop ? location.assign('/app') : finish({ error: 'cancelled' })} disabled={busy}>Cancel</button>
    </form> : <p role="alert">Start a new sync connection from the Branch menu bar app or the Chrome extension.</p>}
  </main>;
}
