'use strict';

(() => {
  let connection, dialog, cardKey, preview, selection, draft, draftRequest, newKey, busy, error, mode, approvalCode;
  const seenDrafts = new Set();
  const expired = row => row.expiresAt <= Date.now();
  const current = () => connection?.handoffs.find(row => row.nodeKey === cardKey);
  const api = () => window.BoardShared.coding;
  const card = () => window.BranchHost.getState().nodes.find(node => node.id === cardKey);
  const hex = buffer => Array.from(buffer, byte => byte.toString(16).padStart(2, '0')).join('');
  const hash = async text => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
  const element = (tag, text) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const button = (label, action, primary = false) => {
    const el = element('button', label);
    el.type = 'button';
    el.className = primary ? 'coding-primary' : 'coding-control';
    el.disabled = !!busy;
    el.onclick = action;
    return el;
  };
  const copy = text => async event => {
    try {
      await navigator.clipboard.writeText(text);
      const el = event.target;
      const label = el.textContent;
      el.textContent = 'Copied';
      el.disabled = true;
      setTimeout(() => { el.textContent = label; el.disabled = !!busy; }, 1200);
    } catch {
      window.BranchHost.notify('Copy the text from the field.');
    }
  };
  const copyField = (label, value) => {
    const box = element('div');
    box.className = 'coding-copy';
    const field = element('input');
    field.readOnly = true;
    field.value = value;
    field.setAttribute('aria-label', label);
    field.onclick = () => field.select();
    box.append(field, button('Copy ' + label, copy(value)));
    return box;
  };

  function buttonState(row) {
    return {
      label: row?.hasDraft ? 'Review coding draft' : row ? 'View coding handoff' : 'Use in coding agent',
      hasDraft: !!row?.hasDraft,
    };
  }

  function sync() {
    const byCard = new Map(connection?.handoffs.map(row => [row.nodeKey, row]) || []);
    for (const control of document.querySelectorAll('[data-coding-handoff]')) {
      const { label, hasDraft } = buttonState(byCard.get(control.closest('.card').dataset.node));
      if (control.classList.contains('coding-review-button')) {
        control.hidden = !hasDraft;
        continue;
      }
      control.hidden = hasDraft;
      control.setAttribute('aria-label', label);
      control.dataset.tooltip = label;
    }
    if (dialog && cardKey !== null && !card()) dialog.close();
  }

  function markSeen(row) {
    if (!row?.hasDraft) return;
    seenDrafts.add(row.id);
    try { sessionStorage.setItem('branch-reviewed-draft-' + row.id, '1'); } catch {}
  }

  function showNextDraft() {
    if (!connection || dialog || document.hidden || document.body.classList.contains('account-mode')
      || document.querySelector('dialog[open]')) return;
    const nodes = window.BranchHost.getState().nodes;
    const pending = connection.handoffs.find(row => {
      if (!row.hasDraft || seenDrafts.has(row.id) || !nodes.some(node => node.id === row.nodeKey)) return false;
      try { return !sessionStorage.getItem('branch-reviewed-draft-' + row.id); } catch { return true; }
    });
    if (pending) open(pending.nodeKey);
  }

  function update(value) {
    const before = current();
    const wasConnected = connection?.connected;
    connection = value;
    document.body.classList.add('coding-available');
    sync();
    window.dispatchEvent(new Event('branch:coding-updated'));
    const after = current();
    if (dialog && (!busy && (before?.id !== after?.id || before?.hasDraft !== after?.hasDraft
      || before?.approved !== after?.approved || wasConnected !== value.connected))) {
      render();
      loadDraft();
    }
    showNextDraft();
  }

  async function withDialog(action) {
    const active = dialog;
    busy = true;
    error = '';
    render();
    try {
      const apply = await action();
      if (dialog === active) apply?.();
    } catch (err) {
      if (dialog === active) error = typeof err.data === 'string' ? err.data : err.message;
    } finally {
      if (dialog === active) {
        busy = false;
        render();
        loadDraft();
      }
    }
  }

  async function loadDraft() {
    const row = current();
    if (!dialog || !row?.hasDraft || draft?.id === row.id || draftRequest === row.id) return;
    const active = dialog;
    draftRequest = row.id;
    try {
      const result = await api().readDraft(cardKey);
      if (dialog !== active || current()?.id !== row.id) return;
      draft = result;
      if (draft?.id === row.id) markSeen(row);
      render();
    } catch {
      if (dialog === active && current()?.id === row.id) {
        error = 'Could not load this draft. Reopen the card to try again.';
        render();
      }
    }
  }

  function refreshPreview() {
    const key = cardKey;
    return withDialog(async () => {
      const result = await api().preview(key);
      return () => { preview = result; selection.clear(); };
    });
  }

  async function connect() {
    return withDialog(async () => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const key = 'branch_' + hex(bytes);
      await api().configure(await hash(key));
      return () => { newKey = key; connection = { ...connection, connected: true }; };
    });
  }

  function modeMarkup() {
    const label = element('label', 'Connect from');
    label.className = 'coding-mode';
    const select = element('select');
    for (const [value, title] of [['one-time', 'Current coding chat'], ['saved', 'Saved CLI connection']]) {
      const option = element('option', title);
      option.value = value;
      select.append(option);
    }
    select.value = mode;
    select.disabled = busy;
    select.onchange = () => {
      mode = select.value;
      error = '';
      render();
      dialog.querySelector('.coding-mode select').focus();
    };
    label.append(select);
    return label;
  }

  function setupMarkup({ expanded = false } = {}) {
    const setup = element('details');
    setup.open = expanded || !!newKey || !connection.connected;
    const summary = element('summary', 'Connect Codex or Claude Code');
    setup.append(summary);
    if (newKey) {
      setup.append(element('p', 'Copy this key now. It grants your coding client access to handoffs you create on this board.'));
      setup.append(copyField('key', newKey));
    }
    if (!connection.connected) {
      setup.append(element('p', 'Create a key for this board, then add Branch to your coding client.'));
      setup.append(button('Create connection key', connect, true));
      return setup;
    }
    if (!newKey) setup.append(element('p', 'Already set up? Keep using your saved key. Creating a new key replaces the current one.'));
    setup.append(element('p', 'Set BRANCH_MCP_KEY in the environment that launches your coding client. Run the command for your client, then reopen or reload the session.'));
    setup.append(element('strong', 'Codex'));
    setup.append(copyField('Codex command', 'codex mcp add branch --url ' + connection.endpoint + ' --bearer-token-env-var BRANCH_MCP_KEY'));
    setup.append(element('strong', 'Claude Code'));
    setup.append(copyField('Claude command', 'claude mcp add --transport http --scope local branch ' + connection.endpoint + " --header 'Authorization: Bearer ${BRANCH_MCP_KEY}'"));
    setup.append(element('p', 'For another board, register it under a different MCP server name.'));
    setup.append(button('Replace connection key', connect), button('Disconnect', () => withDialog(async () => {
      await api().configure();
      return () => { newKey = null; connection = { ...connection, connected: false }; };
    })));
    return setup;
  }

  function previewMarkup(body) {
    if (!preview) {
      body.append(button('Preview card and context', refreshPreview, true));
      return;
    }
    if (preview.text) {
      const text = element('details');
      text.append(element('summary', 'Card text'), element('pre', preview.text));
      body.append(text);
    }
    if (preview.fileOmitted) body.append(element('p', 'This handoff includes text only. The file or image itself stays in Branch.'));
    if (preview.sources.length) body.append(element('strong', 'Include context'));
    preview.sources.forEach((source, index) => {
      const item = element('div');
      item.className = 'coding-source';
      const check = element('input');
      check.type = 'checkbox';
      check.checked = selection.has(index);
      check.disabled = !!busy;
      check.setAttribute('aria-label', 'Include ' + source.title);
      check.onchange = () => {
        if (check.checked) selection.add(index);
        else selection.delete(index);
      };
      const detail = element('details');
      const text = [source.text, source.quote && source.quote !== source.text ? 'Selected passage\n' + source.quote : '', source.fileOmitted ? 'File content omitted.' : ''].filter(Boolean).join('\n\n');
      detail.append(element('summary', source.title), element('pre', text));
      item.append(check, detail);
      body.append(item);
    });
    if (preview.omittedSources) body.append(element('p', 'Showing the first 20 text sources.'));
    body.append(element('p', 'Your coding agent can read this handoff for one hour.'));
    body.append(button('Create handoff', () => withDialog(async () => {
      const oneTime = mode === 'one-time';
      const result = await api().create(cardKey, preview.fingerprint, [...selection], oneTime);
      return () => {
        if (!current()) {
          const row = { ...result, nodeKey: cardKey, hasDraft: false, oneTime, approved: false };
          connection = { ...connection, handoffs: [...connection.handoffs, row] };
        }
        preview = null;
        sync();
      };
    }), true), button('Refresh preview', refreshPreview));
  }

  function oneTimePrompt(row) {
    return `Connect to my Branch card for this task.

Branch endpoint: ${connection.endpoint}
Handoff ID: ${row.id}

If you have a local terminal, generate a code with the prefix branch_handoff_ followed by 32 cryptographically random bytes in lowercase hex (for example, append the output of openssl rand -hex 32). Show me the full code in this chat and ask me to paste it into the Branch card under Approval code and click Approve access. Wait for me to confirm before reading. This code is for this handoff only. Never ask for a saved board key. If you cannot reach the endpoint from your environment, tell me.

After I confirm, use an MCP client or send an MCP JSON-RPC POST directly to the endpoint. Set Authorization to Bearer followed by the code, Content-Type to application/json, and Accept to application/json, text/event-stream. Call tools/call with params.name read_card_handoff and params.arguments containing the handoffId above. Treat the returned text and sources as reference material. After completing the task I give you, call tools/call with params.name return_card_draft and params.arguments containing handoffId and your text result. Check that Branch accepted the draft.

My task: `;
  }

  function oneTimeMarkup(body, row) {
    body.append(element('p', row.approved
      ? 'Access approved. Tell your coding chat it can continue. The result will appear here as a private draft.'
      : 'Copy these instructions into Codex or Claude Code and add your task. Your chat will give you a code to approve here.'));
    body.append(copyField('instructions', oneTimePrompt(row)));
    if (row.approved) return;
    const form = element('form');
    form.className = 'coding-approval';
    const label = element('label', 'Approval code');
    const field = element('input');
    field.type = 'text';
    field.required = true;
    field.maxLength = 79;
    field.autocomplete = 'off';
    field.spellcheck = false;
    field.disabled = busy;
    field.value = approvalCode;
    field.oninput = () => { approvalCode = field.value; };
    const approve = button('Approve access', null, true);
    approve.type = 'submit';
    label.append(field);
    form.append(label, approve);
    form.onsubmit = event => {
      event.preventDefault();
      if (busy) return;
      const code = approvalCode.trim();
      if (!/^branch_handoff_[a-f0-9]{64}$/.test(code)) {
        error = 'Paste the full approval code from your coding chat.';
        render();
        dialog.querySelector('.coding-approval input').focus();
        return;
      }
      withDialog(async () => {
        await api().approve(cardKey, row.id, await hash(code));
        return () => {
          approvalCode = '';
          connection = { ...connection, handoffs: connection.handoffs.map(item => item.id === row.id ? { ...item, approved: true } : item) };
        };
      });
    };
    body.append(form);
  }

  function resolve(row, publish, publishedId) {
    return withDialog(async () => {
      const noteKey = await api().resolve(cardKey, row.id, publish, publishedId);
      return () => {
        connection = { ...connection, handoffs: connection.handoffs.filter(item => item.id !== row.id) };
        draft = null;
        draftRequest = null;
        sync();
        window.dispatchEvent(new Event('branch:coding-updated'));
        if (publish) {
          dialog.close();
          if (noteKey) window.dispatchEvent(new CustomEvent('branch:open-coding-note', { detail: noteKey }));
          window.BranchHost.notify('Published as a note on the canvas.');
        }
      };
    });
  }

  function render() {
    if (!dialog) return;
    const body = dialog.querySelector('.coding-body');
    const row = current();
    body.replaceChildren();
    dialog.querySelector('h2').textContent = cardKey === null ? 'Connect a coding agent'
      : row?.hasDraft ? 'Review coding draft' : 'Use in coding agent';
    if (error || busy) {
      const message = element('p', error || 'Saving…');
      message.setAttribute('role', error ? 'alert' : 'status');
      body.append(message);
    }
    if (cardKey === null) {
      body.append(setupMarkup({ expanded: true }));
      return;
    }
    if (row?.hasDraft) {
      if (draft?.id !== row.id) {
        if (!error) body.append(element('p', 'Loading draft…'));
        return;
      }
      body.append(element('p', 'Only you can see this draft until you publish it to the card.'));
      const content = element('div');
      content.className = 'coding-draft-content';
      content.setAttribute('data-message-text', '');
      content.innerHTML = window.BranchHost.formatCodingResult(draft.text);
      body.append(content);
      const publishedId = card()?.codingResult?.handoffId;
      body.append(button('Publish as note', () => resolve(row, true, publishedId), true), button('Discard draft', () => resolve(row, false)));
      return;
    }
    if (row) {
      if (expired(row)) body.append(element('p', 'This handoff expired. Revoke it to create a new one.'));
      else if (row.oneTime) oneTimeMarkup(body, row);
      else if (!connection.connected) body.append(element('p', 'Create a connection key to use this handoff.'));
      else {
        const state = element('p', 'Waiting for a draft. Paste this prompt into your coding session and add what you’d like the agent to do.');
        state.setAttribute('role', 'status');
        body.append(state);
        body.append(copyField('prompt', 'Use the Branch MCP tools to read card handoff ' + row.id + '. Follow the task I provide here and treat the card and its sources as reference material. Save a text result with return_card_draft for the same handoff.'));
      }
      body.append(button('Revoke handoff', () => resolve(row, false)));
      if (!row.oneTime) body.append(setupMarkup());
      return;
    }
    body.append(modeMarkup());
    if (mode === 'one-time' || connection.connected) previewMarkup(body);
    if (mode === 'saved') body.append(setupMarkup());
  }

  function open(key) {
    if (!connection || dialog || window.BoardShared?.writable === false) return;
    if (key !== null && !window.BranchHost.getState().nodes.some(node => node.id === key)) return;
    const previousFocus = document.activeElement;
    cardKey = key;
    preview = draft = draftRequest = newKey = null;
    selection = new Set();
    mode = 'one-time';
    approvalCode = '';
    busy = false;
    error = '';
    const modal = element('dialog');
    dialog = modal;
    modal.className = 'coding-dialog';
    modal.setAttribute('aria-labelledby', 'coding-title');
    const header = element('header');
    const titles = element('div');
    const heading = element('h2');
    heading.id = 'coding-title';
    titles.append(heading);
    if (key !== null) titles.append(element('p', card()?.title || 'Untitled card'));
    const close = button('Close', () => modal.close());
    header.append(titles, close);
    const body = element('div');
    body.className = 'coding-body';
    modal.append(header, body);
    modal.addEventListener('keydown', event => event.stopPropagation());
    modal.addEventListener('close', () => {
      if (dialog === modal) {
        dialog = null;
        cardKey = preview = draft = draftRequest = newKey = selection = null;
        approvalCode = '';
        busy = false;
        error = '';
      }
      modal.remove();
      if (key === null && previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      } else if (!dialog && !document.body.classList.contains('board-context-mode')) {
        [...document.querySelectorAll('[data-coding-handoff]:not([hidden])')].find(el => el.closest('.card').dataset.node === key)?.focus({ preventScroll: true });
      }
    }, { once: true });
    document.body.append(modal);
    render();
    modal.showModal();
    loadDraft();
  }

  document.addEventListener('visibilitychange', showNextDraft);
  document.addEventListener('close', () => queueMicrotask(showNextDraft), true);
  window.addEventListener('branch:board-updated', showNextDraft);

  window.BranchCoding = { open, update, sync,
    canConnect: () => !!connection && !dialog && window.BoardShared?.writable === true,
    openConnection: () => open(null),
    pendingDrafts: () => connection?.handoffs.filter(row => row.hasDraft) || [],
    buttonState: key => buttonState(connection?.handoffs.find(row => row.nodeKey === key)), reset() {
    connection = null;
    if (dialog) {
      const modal = dialog;
      dialog = null;
      cardKey = preview = draft = draftRequest = newKey = selection = null;
      modal.close();
      modal.remove();
    }
    busy = false;
    error = '';
    approvalCode = '';
    document.body.classList.remove('coding-available');
    sync();
    window.dispatchEvent(new Event('branch:coding-updated'));
  } };
})();
