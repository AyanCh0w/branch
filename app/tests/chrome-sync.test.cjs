const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { createContext, runInContext } = require('node:vm');
const { JSDOM } = require('jsdom');

const source = name => readFileSync(require('node:path').join(__dirname, '../../extensions/branch-sync', name), 'utf8');
const fixture = () => new JSDOM('<main></main>');
const capture = runInContext(source('capture.js') + '\nBranchCapture', createContext({}));

function addTurn(document, id, content, complete = true) {
  const turn = document.createElement('article');
  turn.setAttribute('data-testid', 'conversation-turn-' + id);
  turn.innerHTML = `<div data-message-author-role="assistant" data-message-id="${id}"><div class="markdown">${content}</div></div>`;
  if (complete) turn.insertAdjacentHTML('beforeend', '<button data-testid="copy-turn-action-button">Copy</button>');
  document.querySelector('main').append(turn);
  return turn;
}

test('captures only the new completed answer and leaves history and controls out', () => {
  const { document } = fixture().window;
  addTurn(document, 'previous', '<p>Old reply</p>');
  const seen = capture.baseline(document);
  assert.equal(capture.completedReply(document, seen), null);
  const turn = addTurn(document, 'new', '<p>Hello</p><pre>const x = 1;<button>Copy code</button></pre>', false);
  assert.equal(capture.completedReply(document, seen), null);
  turn.insertAdjacentHTML('beforeend', '<button data-testid="copy-turn-action-button">Copy</button>');
  const stop = document.createElement('button');
  stop.dataset.testid = 'stop-button';
  document.body.append(stop);
  assert.equal(capture.completedReply(document, seen), null);
  stop.remove();
  turn.querySelector('.markdown').classList.add('result-streaming');
  assert.equal(capture.completedReply(document, seen), null);
  turn.querySelector('.markdown').classList.remove('result-streaming');
  const reply = capture.completedReply(document, seen);
  assert.equal(reply.messageId, 'new');
  assert.equal(reply.result, 'Hello\n\n\n\n```\nconst x = 1;\n```');
  seen.add('new');
  assert.equal(capture.completedReply(document, seen), null);
});

test('uses only the current assistant turn and caps the saved text', () => {
  const { document } = fixture().window;
  addTurn(document, 'long', '<p>' + 'x'.repeat(15_000) + '</p>');
  const reply = capture.completedReply(document, new Set());
  assert.ok(reply.result.length <= 12_000);
  assert.match(reply.result, /Reply shortened by Branch/);
  addTurn(document, 'latest', '<p>Still generating</p>', false);
  assert.equal(capture.completedReply(document, new Set()), null);
});

test('captures the current ChatGPT turn after completion without its prompt or other turn content', () => {
  const { document } = new JSDOM(`<main>
    <div data-talvt-turn-state="complete"><div data-response-body="previous"><p>Earlier reply</p></div></div>
    <div data-talvt-turn-state="streaming">
      <div data-user-message-bubble="true">Private prompt</div>
      <div data-response-body="current">
        <p>Outside the final answer</p>
        <div data-dil-response><p>Visible reply</p><button>Copy</button></div>
      </div>
    </div>
  </main>`).window;
  const seen = new Set(['previous']);
  assert.equal(capture.isGenerating(document), true);
  assert.equal(capture.completedReply(document, seen), null);
  const turn = document.querySelector('[data-talvt-turn-state="streaming"]');
  turn.dataset.talvtTurnState = 'complete';
  assert.equal(capture.isGenerating(document), false);
  assert.equal(capture.completedReply(document, seen).result, 'Visible reply');
  assert.equal(capture.completedReply(document, capture.baseline(document)), null);
  turn.dataset.talvtTurnState = 'stopped';
  assert.equal(capture.completedReply(document, seen), null);
});

test('extension worker keeps the write key private and routes saves only from the paired chat', async () => {
  const chat = '12345678-1234-1234-1234-123456789abc';
  const otherChat = '12345678-1234-1234-1234-123456789abd';
  const key = 'branch_chrome_' + 'a'.repeat(64);
  const boardId = 'a'.repeat(32);
  const storage = {};
  const callback = 'https://example.chromiumapp.org/branch';
  let handle;
  const writes = [];
  const context = createContext({
    URL, URLSearchParams, TextEncoder, AbortSignal, crypto: globalThis.crypto,
    chrome: {
      identity: {
        getRedirectURL: () => callback,
        launchWebAuthFlow: async ({ url }) => {
          const start = new URL(url);
          assert.equal(start.origin, 'https://joinbranch.dev');
          const state = new URLSearchParams(start.hash.slice(1)).get('state');
          return callback + '#' + new URLSearchParams({ state, key, board: boardId, title: 'Target',  });
        },
      },
      storage: { local: {
        setAccessLevel: async ({ accessLevel }) => assert.equal(accessLevel, 'TRUSTED_CONTEXTS'),
        get: async chat => ({ [chat]: storage[chat] }),
        set: async fields => Object.assign(storage, fields),
        remove: async chat => delete storage[chat],
      } },
      runtime: { onMessage: { addListener: listener => { handle = listener; } } },
    },
    fetch: async (url, { body }) => {
      assert.match(url, /^https:\/\/joinbranch\.dev\/api\/backend\?chrome=(save|stop)$/);
      const request = JSON.parse(body);
      writes.push({ url, request });
      return { ok: true, json: async () => ({ value: { cardId: 'saved-card', boardTitle: 'Target' } }) };
    },
  });
  runInContext(source('worker.js'), context);
  const request = (action, { from = chat, route = chat, update } = {}) => new Promise(resolve => {
    const handled = handle({ action, chat: route, update }, { frameId: 0, url: 'https://chatgpt.com/c/' + from }, resolve);
    if (!handled) resolve(null);
  });

  const update = { messageId: 'response-1', title: 'Example', result: 'New reply' };
  assert.equal((await request('save', { update })).enabled, false);
  const pairing = await request('connect');
  assert.equal(pairing.boardTitle, 'Target');
  assert.equal(JSON.stringify(pairing).includes(key), false);
  assert.equal(await request('save', { from: otherChat, update }), null);
  assert.equal((await request('save', { update })).hasSaved, true);
  assert.equal(writes.length, 1);
  assert.match(writes[0].request.updateId, /^[a-f0-9-]{36}$/);
  assert.equal(writes[0].request.key, key);
  assert.equal((await request('stop')).enabled, false);
  assert.match(writes[1].url, /chrome=stop$/);
  assert.equal((await request('save', { update })).enabled, false);
  assert.equal(writes.length, 2);
});
