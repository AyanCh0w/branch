import React, { useEffect, useState } from 'react';
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';

export function ConnectChatGPT({ request }) {
  const boards = useQuery(api.library.list, {});
  const authorize = useMutation(api.chatgptOAuth.authorize);
  const [boardId, setBoardId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editable = boards?.filter(board => board.role !== 'viewer');

  async function grant(event) {
    event.preventDefault();
    if (!boardId || busy) return;
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
    const endpoint = request.get('resource');
    if (!endpoint || !URL.canParse(endpoint)) { location.replace('/app'); return; }
    const callback = new URL('https://chatgpt.com/connector_platform_oauth_redirect');
    callback.search = new URLSearchParams({
      error: 'access_denied', state: request.get('state') || '', iss: new URL(endpoint).origin,
    }).toString();
    location.replace(callback.href);
  }

  return <main className="a-link-landing a-chatgpt-consent">
    <h1>Connect ChatGPT to Branch</h1>
    <p>Choose the board where ChatGPT can save updates. Everyone with access to that board can open its shared context.</p>
    <form onSubmit={grant}>
      <label className="a-field">Board
        <select value={boardId} onChange={event => setBoardId(event.target.value)} disabled={busy || !editable?.length} required>
          <option value="">{boards ? 'Choose a board' : 'Loading boards…'}</option>
          {editable?.map(board => <option key={board.id} value={board.id}>{board.title}</option>)}
        </select>
      </label>
      {editable?.length === 0 && <p>Create a board in Branch, then start the connection again.</p>}
      {error && <p role="alert">{error}</p>}
      <button className="a-primary" disabled={!boardId || busy}>{busy ? 'Connecting…' : 'Connect board'}</button>
      <button type="button" className="a-secondary" onClick={cancel} disabled={busy}>Cancel</button>
    </form>
  </main>;
}

export function ChatGPTBoardSettings({ boardId, Dialog, onClose }) {
  const config = useQuery(api.chatgptOAuth.connection, { boardId });
  const disconnect = useMutation(api.chatgptOAuth.disconnect);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  return <Dialog title="ChatGPT connection" onClose={onClose}>
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

export function SharedContext({ boardId, token, Dialog }) {
  const [card, setCard] = useState(null);
  useEffect(() => {
    const show = event => setCard(event.detail);
    window.addEventListener('branch:show-context', show);
    window.dispatchEvent(new CustomEvent('branch:show-initial-context'));
    return () => window.removeEventListener('branch:show-context', show);
  }, []);
  const { results, status, loadMore } = usePaginatedQuery(api.chatgptSync.read,
    card ? { boardId, token, nodeKey: card.id } : 'skip', { initialNumItems: 10 });
  if (!card) return null;
  return <Dialog title="Shared context" onClose={() => setCard(null)} className="a-shared-context">
    <p className="a-muted">{card.title}</p>
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
  </Dialog>;
}
