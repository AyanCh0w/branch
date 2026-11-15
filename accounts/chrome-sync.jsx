import React, { useEffect, useRef, useState } from 'react';
import {handoff,appURL,loadMacInstaller,copyMacSetup} from '../app/desktop-setup';
import { api, useMutation, useQuery } from '../backend/react';
import { isChromeSyncOrigin } from '../collaboration/chrome-sync.cjs';

export const chromeSyncAvailable = isChromeSyncOrigin(location.origin);
export const desktopSyncAvailable = chromeSyncAvailable && location.protocol === 'https:';

function useMacInstaller() {
  const [installer, setInstaller] = useState(undefined);
  useEffect(() => {
    let current = true;
    loadMacInstaller().then(url => { if (current) setInstaller(url); });
    return () => { current = false; };
  }, []);
  return installer;
}
const setupGuide = boardId => '/mac-setup.html?board=' + encodeURIComponent(boardId);

export function ChromeSyncSettings({ boardId, Dialog, onClose }) {
  const count = useQuery(api.chatgptBrowser.count, { boardId });
  const disconnect = useMutation(api.chatgptBrowser.disconnectBoard);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [copyState, setCopyState] = useState('ready');
  const installer = useMacInstaller();
  const fallback = useRef(null);
  useEffect(() => {
    if (copyState === 'manual') {
      fallback.current?.focus();
      fallback.current?.select();
    }
  }, [copyState]);

  async function copySetup() {
    setCopyState('copying');
    setCopyState(await copyMacSetup(handoff(boardId), copyState === 'copied' || copyState === 'manual' ? null : installer) ? 'copied' : 'manual');
  }

  return <Dialog title="Conversation sync" onClose={onClose}>
    <p>{installer ? 'Download Branch for Mac and copy setup instructions in one click.' : 'Copy setup instructions, then paste them into the conversation you want to sync.'} New replies will appear in this board’s Context.</p>
    <button type="button" className="a-primary" disabled={installer === undefined || copyState === 'copying'} onClick={copySetup}>
      {copyState === 'copied' ? '✓ Copied to clipboard' : 'Set up with your agent'}
    </button>
    <div role="status">{copyState === 'copied' && <p>Paste the instructions into the conversation you want to sync.</p>}
      {copyState === 'manual' && <p>Copy the selected instructions, then paste them into the conversation you want to sync.</p>}
      {installer && (copyState === 'copied' || copyState === 'manual') && <p>Open the installer from Downloads. <a href={installer} download>Download again</a></p>}</div>
    {copyState === 'manual' && <label className="a-field">Setup instructions
      <textarea ref={fallback} rows={5} readOnly value={handoff(boardId)} />
    </label>}
    {installer === null && <p className="a-muted">The Mac installer isn’t available here yet. If you don’t have the app, see the <a href={setupGuide(boardId)}>installation guide</a>.</p>}
    {!!count && <button type="button" className="a-secondary" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        await disconnect({ boardId });
        setStatus('Disconnected your synced conversations from this board.');
      } catch {
        setStatus('Could not disconnect. Try again.');
      } finally {
        setBusy(false);
      }
    }}>Disconnect conversations ({count})</button>}
    {status && <p role="status">{status}</p>}
  </Dialog>;
}

export function OpenBranchForMac({ boardId, Dialog, onClose, onOpen }) {
  const [launching, setLaunching] = useState(false);
  const [status, setStatus] = useState('');
  const installer = useMacInstaller();
  return <Dialog title="Connect to this board" onClose={onClose}>
    <p>Choose which conversation to sync in Branch for Mac.</p>
    <button type="button" className="a-primary" disabled={launching} onClick={async () => {
      setLaunching(true);
      try {
        await onOpen();
        setStatus('Continue in Branch for Mac.');
      } catch {
        setStatus('Could not open Branch for Mac. Try again.');
      } finally {
        setLaunching(false);
      }
    }}>{launching ? 'Opening Branch for Mac…' : 'Open Branch for Mac'}</button>
    <p role="status">{status}</p>
    {installer && <p>Don’t have the app? <a href={installer} download>Download Branch for Mac</a>, install it, then click Open Branch for Mac.</p>}
    <a className="a-muted" href={setupGuide(boardId)}>Installation guide ↗</a>
    {installer === null && <p className="a-muted">The Mac installer isn’t available here yet.</p>}
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
  const [approvedBoardId, setApprovedBoardId] = useState('');
  const editable = boards?.filter(board => board.role !== 'viewer');
  const selected = editable?.find(board => board.id === boardId) || (editable?.length === 1 ? editable[0] : null);
  const state = request.get('state') || '';
  const conversationId = request.get('conversation') || '';
  const keyHash = request.get('challenge') || '';
  const valid = /^[0-9a-f]{64}$/.test(conversationId)
    && (desktop ? /^[0-9a-f]{64}$/.test(keyHash) : /^[0-9a-f-]{36}$/.test(state));
  const finish = fields => location.replace(chromeCallback + '#' + new URLSearchParams({ state, ...fields }));

  return <main className="a-link-landing a-chatgpt-consent">
    <h1>{desktop ? 'Connect a conversation on Mac' : 'Sync this ChatGPT conversation'}</h1>
    <p>New replies will save to the board you choose. Anyone with access to that board can read them.</p>
    {approvedBoardId ? <><p role="status">Board approved. When Branch for Mac says Sync is on, send a new message in the conversation you connected.</p>
      <p><a className="a-primary" href={'/app?board='+encodeURIComponent(approvedBoardId)}>Open this board ↗</a></p>
      <a className="a-muted" href={appURL()}>Return to Branch for Mac ↗</a></> : valid ? <form onSubmit={async event => {
      event.preventDefault();
      if (busy || !selected) return;
      setBusy(true);
      setError('');
      try {
        if (desktop) {
          await connectDesktop({ boardId: selected.id, conversationId, keyHash });
          setApprovedBoardId(selected.id);
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
