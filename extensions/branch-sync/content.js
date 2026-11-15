(() => {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { all: initial; position: fixed; right: 18px; bottom: 58px; z-index: 10000;
        font: 13px/1.45 system-ui, sans-serif; color: #22242a; }
      [hidden] { display: none !important; }
      button, a { font: inherit; color: inherit; }
      button { cursor: pointer; }
      button:disabled { opacity: .55; cursor: default; }
      :focus-visible { outline: 2px solid #416ebd; outline-offset: 3px; }
      #badge { max-width: min(260px, 70vw); display: flex; align-items: center; gap: 8px;
        background: #fff; border: 1px solid #dce0e6; padding: 7px 12px; border-radius: 999px;
        box-shadow: 0 2px 6px #20252c14; font-weight: 600; }
      #destination { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      #nib { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #9ca2ad; }
      #badge[data-sync="on"] #nib { background: #507bcf; }
      #panel { box-sizing: border-box; width: min(272px, calc(100vw - 36px)); position: absolute; right: 0;
        bottom: 42px; background: #fff; padding: 14px; border: 1px solid #dce0e6; border-radius: 12px;
        box-shadow: 0 3px 12px #20252c20; }
      #panel strong { font-size: 14px; }
      p { margin: 6px 0 12px; color: #505662; overflow-wrap: anywhere; }
      #status { margin-bottom: 0; }
      #actions { display: flex; flex-wrap: wrap; gap: 7px; }
      #actions button, a { text-decoration: none; border: 1px solid #dce0e6; background: #fff;
        padding: 5px 9px; border-radius: 7px; }
      #actions button[data-primary] { background: #282b31; color: #fff; border-color: #282b31; }
    </style>
    <button type="button" id="badge" aria-expanded="false" aria-controls="panel" hidden>
      <span id="nib" aria-hidden="true"></span><span id="destination">Branch sync</span>
    </button>
    <section id="panel" aria-label="Branch sync" hidden>
      <strong id="heading">Branch sync</strong>
      <p id="explanation"></p>
      <div id="actions">
        <button type="button" data-primary id="connect">Choose a board</button>
        <a id="open" target="_blank" rel="noopener noreferrer" hidden>Open in Branch</a>
        <button type="button" id="stop" hidden>Stop syncing</button>
        <button type="button" id="retry" hidden>Retry save</button>
      </div>
      <p role="status" id="status" hidden></p>
    </section>`;
  const byId = id => root.getElementById(id);
  const badge = byId('badge');
  const panel = byId('panel');
  let session;
  let timer;

  function chatId() {
    return location.pathname.match(/^\/(?:g\/[^/]+\/)?c\/([a-f0-9-]{36})\/?$/i)?.[1]?.toLowerCase() || null;
  }

  function toggle(open) {
    panel.hidden = !open;
    badge.setAttribute('aria-expanded', String(open));
  }

  function render() {
    const { chat, config, notice, busy, queue, activity } = session;
    const enabled = !!config?.enabled;
    badge.hidden = !chat;
    badge.dataset.sync = enabled ? 'on' : 'off';
    const name = enabled ? config.boardTitle : 'Branch sync';
    byId('destination').textContent = name;
    badge.setAttribute('aria-label', enabled ? 'Branch sync on for ' + name : 'Branch sync');
    byId('heading').textContent = name;
    byId('explanation').textContent = enabled
      ? 'New replies in this chat are saved to this board.'
      : 'Automatically save new replies from this chat to a Branch board.';
    byId('connect').hidden = enabled;
    byId('stop').hidden = !enabled;
    byId('open').hidden = !enabled;
    byId('retry').hidden = !queue.length || !notice;
    if (enabled) byId('open').href = config.url;
    else byId('open').removeAttribute('href');
    byId('connect').disabled = byId('stop').disabled = byId('retry').disabled = busy;
    const status = byId('status');
    status.textContent = notice || activity || (config?.hasSaved ? 'Saved to Branch' : '');
    status.hidden = !status.textContent;
  }

  function current(active) {
    return session === active && chatId() === active.chat;
  }

  async function send(active, action, update) {
    const state = await chrome.runtime.sendMessage({ action, chat: active.chat, update });
    if (!state) throw Error('Reload ChatGPT to reconnect the Branch extension.');
    if (state.error) throw Error(state.error);
    return state;
  }

  function watchRoute() {
    const chat = chatId();
    if (session?.chat === chat) return;
    toggle(false);
    const active = { chat, seen: BranchCapture.baseline(document), queue: [], busy: true };
    session = active;
    render();
    if (!chat) return;
    send(active, 'status').then(config => {
      if (!current(active)) return;
      active.config = config;
      active.notice = config.notice;
      active.canCapture = false;
    }).catch(error => { if (current(active)) active.notice = error.message; }).finally(() => {
      if (!current(active)) return;
      active.busy = false;
      render();
    });
  }

  async function save(active) {
    if (!current(active) || active.busy || active.saving || !active.queue.length || !active.config?.enabled) return;
    const update = active.queue[0];
    active.saving = true;
    active.notice = '';
    active.activity = 'Saving reply…';
    render();
    try {
      const state = await send(active, 'save', update);
      if (current(active) && active.queue[0] === update) {
        active.config = state;
        active.notice = state.notice;
        active.queue.shift();
        if (!state.enabled) active.queue.length = 0;
      }
    } catch (error) {
      if (current(active) && active.queue[0] === update) {
        active.notice = error.message;
        toggle(true);
      }
    } finally {
      active.saving = false;
      active.activity = '';
      if (current(active)) {
        render();
        if (active.queue.length && !active.notice) void save(active);
      }
    }
  }

  function inspect() {
    watchRoute();
    const active = session;
    if (!active.chat || active.busy || !active.config?.enabled) return;
    if (BranchCapture.isGenerating(document)) active.canCapture = true;
    // Only a reply generated in this tab after the connection can enter the pipeline.
    if (!active.canCapture) {
      active.seen = BranchCapture.baseline(document);
      return;
    }
    const reply = BranchCapture.completedReply(document, active.seen);
    if (!reply) return;
    active.canCapture = false;
    active.seen.add(reply.messageId);
    active.queue.push({ ...reply, title: document.title.replace(/\s*[|–-]\s*ChatGPT\s*$/, '') });
    if (active.queue.length === 1) void save(active);
  }

  function schedule() {
    watchRoute();
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      inspect();
    }, 350);
  }

  async function change(action) {
    const active = session;
    if (active.busy || !active.chat) return;
    active.busy = true;
    active.notice = '';
    render();
    try {
      const state = await send(active, action);
      if (current(active)) {
        active.config = state;
        active.notice = state.notice;
        active.queue.length = 0;
        active.canCapture = false;
        active.seen = BranchCapture.baseline(document);
      }
    } catch (error) {
      if (current(active)) active.notice = error.message;
    } finally {
      active.busy = false;
      if (current(active)) render();
    }
  }

  badge.addEventListener('click', event => { if (event.isTrusted) toggle(panel.hidden); });
  byId('connect').addEventListener('click', event => { if (event.isTrusted) void change('connect'); });
  byId('stop').addEventListener('click', event => { if (event.isTrusted) void change('stop'); });
  byId('retry').addEventListener('click', event => { if (event.isTrusted) void save(session); });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      toggle(false);
      badge.focus();
    }
  });

  addEventListener('focus', async () => {
    const active = session;
    if (!active?.chat || active.busy || active.saving || active.queue.length) return;
    try {
      const config = await send(active, 'status');
      if (!current(active) || active.busy || active.saving || active.queue.length) return;
      if (active.config?.enabled !== config.enabled) {
        active.canCapture = false;
        active.seen = BranchCapture.baseline(document);
      }
      active.config = config;
      active.notice = config.notice;
      render();
    } catch {
      // The next user action displays reconnect errors.
    }
  });

  document.documentElement.append(host);
  watchRoute();
  new MutationObserver(() => {
    if (session.chat && !session.busy && session.config?.enabled && chatId() === session.chat
      && BranchCapture.isGenerating(document)) session.canCapture = true;
    schedule();
  }).observe(document.body, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'data-testid', 'aria-label', 'data-is-streaming', 'data-talvt-turn-state'] });
  addEventListener('popstate', schedule);
})();
