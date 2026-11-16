import React, { useRef, useState } from 'react';
import { api, useMutation, useQuery } from '../backend/react';

function setupInstructions(boardId, code) {
  const server = new URL('/api/backend?agent=1', location.origin).href;
  const board = new URL('/app', location.origin);
  board.searchParams.set('board', boardId);
  return [
    'Connect an agent to this Branch board',
    board.href,
    '',
    '1. In your agent’s settings, add a remote MCP server named Branch (Streamable HTTP).',
    '   Server URL: ' + server,
    '2. Set authentication to Bearer token and enter the connection key below. If your client asks for a header instead, use Authorization: Bearer followed by a space and the key.',
    '   Connection key: ' + code,
    '   Save the connection. Keep the key in private settings, outside chats and shared files.',
    '3. Open the conversation you want to use and send: “Use Branch to read the board and its project instructions.”',
  ].join('\n');
}

export function BoardAgentSettings({ boardId, Dialog, onClose }) {
  const settings = useQuery(api.boardAgents.settings, { boardId, token: '' });
  return <Dialog title="Board agents" onClose={onClose}>
    {settings ? <BoardAgentForm boardId={boardId} settings={settings} /> : <p role="status">Loading agents…</p>}
  </Dialog>;
}

function BoardAgentForm({ boardId, settings }) {
  const connect = useMutation(api.boardAgents.connect);
  const disconnect = useMutation(api.boardAgents.disconnect);
  const saveInstructions = useMutation(api.boardAgents.saveInstructions);
  const oldSyncCount = useQuery(api.chatgptBrowser.count, { boardId });
  const disconnectOldSync = useMutation(api.chatgptBrowser.disconnectBoard);
  const issuedNames = useRef(new Set());
  const [readOnly, setReadOnly] = useState(false);
  const [draft, setDraft] = useState(null);
  const [lastSave, setLastSave] = useState(null);
  const [connection, setConnection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copyState, setCopyState] = useState('ready');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const scope = { boardId, token: '' };
  const savedInstructions = lastSave?.version > settings.instructions.version ? lastSave : settings.instructions;
  const stale = draft && draft.version !== savedInstructions.version;

  async function run(action) {
    setBusy(true);
    setStatus('');
    setError('');
    try { await action(); }
    catch (error) { setError(error.message || 'Could not save the change.'); }
    finally { setBusy(false); }
  }

  async function copySetup() {
    await run(async () => {
      setCopyState('copying');
      const getConnection = async () => {
        if (connection) return connection;
        const names = new Set([...issuedNames.current, ...settings.connections.map(agent => agent.name)]);
        let number = 1;
        while (names.has('Board agent ' + number)) number++;
        const name = 'Board agent ' + number;
        const created = await connect({ ...scope, name, mode: readOnly ? 'read' : 'edit' });
        const current = { id: created.id, instructions: setupInstructions(boardId, created.code) };
        issuedNames.current.add(name);
        setConnection(current);
        return current;
      };
      const pending = getConnection();
      try {
        const clipboard = navigator.clipboard;
        if (clipboard?.write && typeof ClipboardItem === 'function') {
          // Start the clipboard write inside the click gesture, before the server returns the key.
          const contents = pending.then(value => new Blob([value.instructions], { type: 'text/plain' }));
          // A denied clipboard can reject independently of the pending connection.
          void contents.catch(() => {});
          await clipboard.write([new ClipboardItem({ 'text/plain': contents })]);
        } else {
          const value = await pending;
          await clipboard.writeText(value.instructions);
        }
        setCopyState('copied');
        setStatus('Setup instructions copied. Use them in your agent’s private settings, then send the test message.');
      } catch {
        try {
          await pending;
          setCopyState('manual');
          setStatus('Clipboard unavailable. Copy the setup instructions below.');
        } catch {
          setCopyState('ready');
          throw Error('Could not create the connection. Try copying again.');
        }
      }
    });
  }

  function resetSetup() {
    setConnection(null);
    setCopyState('ready');
    setStatus('');
  }

  return <div className="a-agent-settings">
    <section className="a-agent-setup" aria-label="Agent setup">
      <p>Give an agent access to this board so it can {readOnly ? 'read the project context' : 'read the board and post updates in Context'}.</p>
      <ol>
        <li>Copy the setup instructions.</li>
        <li>Add Branch in your agent’s settings.</li>
        <li>Ask your agent to read the board.</li>
      </ol>
      <button type="button" className="a-primary" onClick={copySetup} disabled={busy}>
        {copyState === 'copying' ? 'Copying…' : copyState === 'copied' ? '✓ Copied to clipboard' : 'Copy setup instructions'}
      </button>
      {copyState === 'manual' && connection && <label className="a-field">Setup instructions
        <textarea value={connection.instructions} rows={6} readOnly onFocus={event => event.target.select()} />
      </label>}
      {connection && copyState !== 'copying' &&
        <button type="button" className="a-text-button a-agent-add" disabled={busy} onClick={resetSetup}>Set up another agent</button>}
    </section>

    <details className="a-agent-options">
      <summary>Agent settings</summary>
      {!connection && <label className="a-agent-access">
        <input type="checkbox" checked={readOnly} disabled={busy} onChange={event => setReadOnly(event.target.checked)} />
        Read only for the next connection
      </label>}
      <form className="a-agent-section" onSubmit={event => {
        event.preventDefault();
        if (!draft || stale || busy) return;
        void run(async () => {
          const saved = await saveInstructions({ ...scope, text: draft.text, expectedVersion: draft.version });
          setLastSave(saved);
          setDraft(null);
          setStatus('Project instructions saved.');
        });
      }}>
        <label className="a-field">
          <strong>Project instructions (optional)</strong>
          <textarea value={draft?.text ?? savedInstructions.text} rows={4} maxLength={12000}
            disabled={busy} placeholder="Add shared goals, decisions, or guidelines."
            onChange={event => setDraft({ text: event.target.value, version: draft?.version ?? savedInstructions.version })} />
        </label>
        {stale && <p role="status">Someone updated the saved instructions. Copy any changes you want to keep before loading the latest version.</p>}
        <div className="a-agent-actions">
          <button type="submit" className="a-secondary" disabled={busy || !draft || stale ||
            draft.text === savedInstructions.text}>Save instructions</button>
          {stale && <button type="button" className="a-text-button" onClick={() => setDraft(null)}>Load latest</button>}
        </div>
      </form>

      {!!settings.connections.length && <section className="a-agent-section" aria-label="Agent connections">
        <strong>Agent connections</strong>
        <ul className="a-agent-list">{settings.connections.map(agent => <li key={agent.id}>
          <span>{agent.name}<small>{agent.mode === 'edit' ? 'Read and contribute' : 'Read only'}</small></span>
          <button type="button" className="a-secondary" disabled={busy} aria-label={'Disconnect ' + agent.name}
            onClick={() => run(async () => {
              await disconnect({ ...scope, connectionId: agent.id });
              if (connection?.id === agent.id) resetSetup();
              setStatus(agent.name + ' disconnected.');
            })}>Disconnect</button>
        </li>)}</ul>
      </section>}
      {oldSyncCount > 0 && <section className="a-agent-section" aria-label="Previous chat connections">
        <button type="button" className="a-secondary" disabled={busy} onClick={() => run(async () => {
          await disconnectOldSync({ boardId });
          setStatus('Previous chat connections disconnected.');
        })}>Disconnect previous chats ({oldSyncCount})</button>
      </section>}
    </details>
    <div aria-live="polite">{status && <p role="status">{status}</p>}</div>
    {error && <p className="a-error" role="alert">{error}</p>}
  </div>;
}
