import React, { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';

export function ConnectChatGPT({ request }) {
  const boards = useQuery(api.library.list, {});
  const authorize = useMutation(api.chatgptOAuth.authorize);
  const [boardId, setBoardId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const editable = boards?.filter(board => board.role !== 'viewer');

  async function grant(event) {
    event.preventDefault();
    if (!boardId || !confirmed || busy) return;
    setBusy(true);
    setError('');
    try {
      const fields = Object.fromEntries(['state', 'challenge', 'clientId', 'redirectUri', 'resource'].map(key => [key, request.get(key) || '']));
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const hex = value => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
      const code = hex(bytes);
      const codeHash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))));
      const { redirect, issuer } = await authorize({ ...fields, boardId, codeHash });
      const callback = new URL(redirect);
      callback.search = new URLSearchParams({ code, state: fields.state, iss: issuer }).toString();
      location.replace(callback.href);
    } catch {
      setError('Could not connect this board. Return to ChatGPT and start the connection again.');
      setBusy(false);
    }
  }

  function cancel() {
    // The issuer is Branch's own connector base, not whatever the link claims.
    const endpoint = request.get('resource') || '';
    if (!/^https?:\/\/[^?#]+\/chatgpt\/mcp$/.test(endpoint) || !URL.canParse(endpoint)) { location.replace('/app'); return; }
    const callback = new URL('https://chatgpt.com/connector_platform_oauth_redirect');
    callback.search = new URLSearchParams({
      error: 'access_denied', state: request.get('state') || '', iss: endpoint.replace(/\/chatgpt\/mcp$/, ''),
    }).toString();
    location.replace(callback.href);
  }

  return <main className="a-link-landing a-chatgpt-consent">
    <h1>Connect ChatGPT to Branch</h1>
    <p>Approving lets the ChatGPT account that started this connection add updates to the board you choose, as you, until you disconnect it. Everyone with access to that board can read them.</p>
    <p className="a-chatgpt-warning" role="note">Only continue if you started this connection from your own ChatGPT just now. If someone sent you this link, cancel.</p>
    <form onSubmit={grant}>
      <label className="a-field">Board
        <select value={boardId} onChange={event => setBoardId(event.target.value)} disabled={busy || !editable?.length} required>
          <option value="">{boards ? 'Choose a board' : 'Loading boards…'}</option>
          {editable?.map(board => <option key={board.id} value={board.id}>{board.title}</option>)}
        </select>
      </label>
      {editable?.length === 0 && <p>Create a board in Branch, then start the connection again.</p>}
      <label className="a-chatgpt-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} /><span>I started this from my own ChatGPT account{boardId ? ', and I want it to add updates to “' + (editable?.find(board => board.id === boardId)?.title || 'this board') + '”' : ''}.</span></label>
      {error && <p role="alert">{error}</p>}
      <button className="a-primary" disabled={!boardId || !confirmed || busy}>{busy ? 'Connecting…' : 'Allow ChatGPT'}</button>
      <button type="button" className="a-secondary" onClick={cancel} disabled={busy}>Cancel</button>
    </form>
  </main>;
}

export function ChatGPTBoardSettings({ boardId, Dialog, onClose }) {
  const config = useQuery(api.chatgptOAuth.connection, { boardId });
  const disconnect = useMutation(api.chatgptOAuth.disconnect);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  return <Dialog title="ChatGPT sync" onClose={onClose}>
    {config && <>
      <p>Use this URL when adding Branch as a custom MCP server in ChatGPT. During setup, choose the board that should receive updates.</p>
      <label className="a-field">Connector URL<input readOnly value={config.endpoint} onFocus={event => event.target.select()} /></label>
      <button className="a-secondary" onClick={async () => {
        try { await navigator.clipboard.writeText(config.endpoint); setStatus('Copied URL'); }
        catch { setStatus('Select and copy the URL in the field.'); }
      }}>Copy URL</button>
      {config.connected && <button className="a-secondary" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await disconnect({ boardId }); setStatus('Disconnected from this board.'); }
        catch { setStatus('Could not disconnect. Try again.'); }
        finally { setBusy(false); }
      }}>Disconnect</button>}
    </>}
    <p role="status">{status}</p>
  </Dialog>;
}
