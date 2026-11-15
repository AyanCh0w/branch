import React, { useState } from 'react';
import { api, useMutation, useQuery } from '../backend/react';

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
  const [name, setName] = useState('');
  const [mode, setMode] = useState('edit');
  const [draft, setDraft] = useState(null);
  const [lastSave, setLastSave] = useState(null);
  const [connection, setConnection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const scope = { boardId, token: '' };
  const endpoint = new URL('/api/backend?agent=1', location.origin).href;
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

  async function copy(value, label) {
    setError('');
    try {
      await navigator.clipboard.writeText(value);
      setStatus(label + ' copied.');
    } catch {
      setError('Select the text to copy it manually.');
    }
  }

  return <div className="a-agent-settings">
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
        <strong>Project instructions</strong>
        <textarea value={draft?.text ?? savedInstructions.text} rows={4} maxLength={12000}
          disabled={busy} placeholder="What should agents know about this board?"
          onChange={event => setDraft({ text: event.target.value, version: draft?.version ?? savedInstructions.version })} />
      </label>
      {stale && <p role="status">Someone updated the saved instructions. Copy any changes you want to keep before loading the latest version.</p>}
      <div className="a-agent-actions">
        <button type="submit" className="a-secondary" disabled={busy || !draft || stale ||
          draft.text === savedInstructions.text}>Save instructions</button>
        {stale && <button type="button" className="a-text-button" onClick={() => setDraft(null)}>Load latest</button>}
      </div>
    </form>

    <form className="a-agent-section" onSubmit={event => {
      event.preventDefault();
      if (!name.trim() || busy) return;
      void run(async () => {
        const created = await connect({ ...scope, name: name.trim(), mode });
        setConnection({ ...created, name: name.trim() });
        setName('');
      });
    }}>
      <p>Connect an agent to this board through its MCP settings.</p>
      <label className="a-field">Agent name
        <input value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder="e.g. API planner" required disabled={busy} />
      </label>
      <label className="a-field">Board access
        <select value={mode} onChange={event => setMode(event.target.value)} disabled={busy}>
          <option value="edit">Read and contribute</option>
          <option value="read">Read only</option>
        </select>
      </label>
      <button type="submit" className="a-primary" disabled={busy || !name.trim()}>Connect agent</button>
    </form>

    {connection && <section className="a-agent-section" aria-label="Agent connection details">
      <strong>Connect {connection.name}</strong>
      <p>Use these in a client that supports a remote MCP server with a bearer token. Save the key now. Branch only shows it once.</p>
      <label className="a-field">Server URL<input value={endpoint} readOnly onFocus={event => event.target.select()} /></label>
      <label className="a-field">Connection key<input value={connection.code} readOnly onFocus={event => event.target.select()} /></label>
      <div className="a-agent-actions">
        <button type="button" className="a-secondary" onClick={() => copy(endpoint, 'Server URL')}>Copy URL</button>
        <button type="button" className="a-secondary" onClick={() => copy(connection.code, 'Connection key')}>Copy key</button>
      </div>
    </section>}

    {!!settings.connections.length && <section className="a-agent-section" aria-label="Connected agents">
      <strong>Connected agents</strong>
      <ul className="a-agent-list">{settings.connections.map(agent => <li key={agent.id}>
        <span>{agent.name}<small>{agent.mode === 'edit' ? 'Read and contribute' : 'Read only'}</small></span>
        <button type="button" className="a-secondary" disabled={busy} aria-label={`Disconnect ${agent.name}`}
          onClick={() => run(async () => {
            await disconnect({ ...scope, connectionId: agent.id });
            setConnection(previous => previous?.id === agent.id ? null : previous);
            setStatus(`${agent.name} disconnected.`);
          })}>Disconnect</button>
      </li>)}</ul>
    </section>}
    {status && <p role="status">{status}</p>}
    {error && <p className="a-error" role="alert">{error}</p>}
  </div>;
}
