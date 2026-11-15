const branch = 'https://joinbranch.dev';
const callback = chrome.identity.getRedirectURL('branch');
const storageKey = chat => branch + ':' + chat;
const disconnected = 'chrome_sync_disconnected';
const updates = new Map();
const connections = new Map();
const stops = new Map();

const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

function conversationFrom(url) {
  if (!url) return null;
  const { origin, pathname } = new URL(url);
  if (origin !== 'https://chatgpt.com') return null;
  return pathname.match(/^\/(?:g\/[^/]+\/)?c\/([a-f0-9-]{36})\/?$/i)?.[1]?.toLowerCase() || null;
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function configuration(chat) {
  const key = storageKey(chat);
  return (await chrome.storage.local.get(key))[key];
}

function view(config) {
  if (!config) return { enabled: false };
  const url = new URL('/app', branch);
  url.searchParams.set('board', config.boardId);
  if (config.cardId) url.searchParams.set('context', config.cardId);
  return { enabled: true, boardTitle: config.boardTitle, url: url.href, hasSaved: !!config.cardId };
}

async function connect(chat) {
  const state = crypto.randomUUID();
  const start = new URL('/app', branch);
  start.hash = new URLSearchParams({ 'chrome-sync': '1', state, conversation: await digest('chrome:' + chat) });
  let result;
  try {
    result = await chrome.identity.launchWebAuthFlow({ url: start.href, interactive: true });
  } catch {
    throw Error('Could not open Branch. Sign in at joinbranch.dev, then try again.');
  }
  const redirect = result && new URL(result);
  const fields = new URLSearchParams(redirect?.hash.slice(1));
  if (!redirect || redirect.origin + redirect.pathname !== callback || fields.get('state') !== state) {
    throw Error('Branch could not verify this connection.');
  }
  if (fields.get('error') === 'cancelled') return view(await configuration(chat));
  const key = fields.get('key') || '';
  const boardId = fields.get('board') || '';
  if (!/^branch_chrome_[a-f0-9]{64}$/.test(key) || !/^[A-Za-z0-9_-]{1,160}$/.test(boardId)) {
    throw Error('Branch returned an invalid connection.');
  }
  const config = {
    key, boardId, boardTitle: fields.get('title') || 'Branch board',
    cardId: null,
  };
  await chrome.storage.local.set({ [storageKey(chat)]: config });
  return view(config);
}

async function callBranch(config, name, args = {}) {
  const response = await fetch(branch + '/api/backend?chrome=' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...args, key: config.key }),
    signal: AbortSignal.timeout(8000), credentials: 'omit', redirect: 'error',
  }).catch(() => { throw Error('Could not reach Branch. Check your internet connection.'); });
  const body = await response.json();
  if (response.ok) return body.value;
  if (response.status === 401 && body.error === disconnected) throw Error(disconnected);
  if (typeof body.error === 'string') throw Error(body.error);
  throw Error('Branch could not save this reply.');
}

async function stop(chat, config) {
  // Disable new writes before waiting for the revocation request.
  await chrome.storage.local.remove(storageKey(chat));
  if (!config) return view(null);
  try {
    const inFlight = [...updates].filter(([key]) => key.startsWith(config.key)).map(([, save]) => save);
    await Promise.allSettled(inFlight);
    if ((await configuration(chat))?.key === config.key) await chrome.storage.local.remove(storageKey(chat));
    await callBranch(config, 'stop');
    return view(null);
  } catch {
    return { ...view(null), notice: 'Sync is off here. When Branch is online, revoke this connection in the board’s sync settings.' };
  }
}

function deduplicate(map, key, run) {
  if (!map.has(key)) map.set(key, run().finally(() => map.delete(key)));
  return map.get(key);
}

async function forgetRevoked(chat, config) {
  if ((await configuration(chat))?.key !== config.key) return view(await configuration(chat));
  await chrome.storage.local.remove(storageKey(chat));
  return { ...view(null), notice: 'Branch disconnected this chat. Choose a board to sync again.' };
}

async function status(chat, config) {
  if (!config) return view(null);
  try {
    return view({ ...config, ...await callBranch(config, 'status') });
  } catch (error) {
    if (error.message === disconnected) return forgetRevoked(chat, config);
    return { ...view(config), notice: 'Could not check the connection. Check your internet connection.' };
  }
}

async function save(chat, config, update) {
  if (!config || stops.has(chat)) return view(null);
  const { messageId, title, result } = update || {};
  if (typeof messageId !== 'string' || messageId.length < 1 || messageId.length > 128
    || typeof title !== 'string' || typeof result !== 'string' || !result.trim() || result.length > 12_000) {
    throw Error('This reply could not be captured.');
  }
  const hash = (await digest(chat + ':' + messageId)).slice(0, 32);
  const updateId = hash.replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
  return deduplicate(updates, config.key + updateId, async () => {
    try {
      if ((await configuration(chat))?.key !== config.key || stops.has(chat)) return view(null);
      const saved = await callBranch(config, 'save', { updateId, title: title.trim().slice(0, 120) || 'ChatGPT conversation', result });
      const current = await configuration(chat);
      if (current?.key !== config.key || stops.has(chat)) return view(current);
      const next = { ...current, ...saved };
      await chrome.storage.local.set({ [storageKey(chat)]: next });
      return view(next);
    } catch (error) {
      if (error.message !== disconnected) throw error;
      return forgetRevoked(chat, config);
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const chat = conversationFrom(sender.url);
  if (sender.frameId !== 0 || !chat || chat !== message?.chat) return false;
  (async () => {
    await ready;
    const config = await configuration(chat);
    switch (message.action) {
      case 'status': return status(chat, config);
      case 'connect': {
        if (stops.has(chat)) await stops.get(chat);
        const existing = await configuration(chat);
        return existing ? view(existing) : deduplicate(connections, chat, () => connect(chat));
      }
      case 'stop': return deduplicate(stops, chat, () => stop(chat, config));
      case 'save': return save(chat, config, message.update);
      default: throw Error('Unknown sync action.');
    }
  })().then(reply, error => reply({ error: error.message || 'Could not reach Branch.' }));
  return true;
});
