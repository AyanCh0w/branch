import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { harness } from './harness';
import { codingRequest } from '../coding-http';

let h: Awaited<ReturnType<typeof harness>>;
let owner: { userId: string; authId: string };
let viewer: { userId: string; authId: string };
let boardId: string;
const scope = () => ({ boardId, token: '' });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

beforeAll(async () => {
  h = await harness();
  owner = await h.account('context-owner');
  viewer = await h.account('context-viewer');
  boardId = await h.call(owner, 'library:create', { title: 'Agent context' });
  await h.call(owner, 'sharing:addMember', { boardId, username: 'context-viewer', role: 'viewer' });
});
afterAll(() => h?.close());

it('stores replies per conversation, rejects unapproved writes, and limits reads to board members', async () => {
  const conversationId = hash('chrome:chat-1');
  await expect(h.call(viewer, 'chatgptBrowser:connect', { boardId, conversationId })).rejects.toThrow('Board access denied');
  const { key } = await h.call(owner, 'chatgptBrowser:connect', { boardId, conversationId });
  const update = { key, updateId: randomUUID(), title: 'Research', result: 'First answer' };
  const save = (args: object) => h.engine.call('chatgptBrowser:save', args, {}, 'mutation', true);
  await expect(h.call({}, 'chatgptBrowser:save', update)).rejects.toThrow('Unknown operation');
  const [first, retry] = await Promise.all([save(update), save(update)]);
  expect(retry).toEqual(first);
  await save({ ...update, updateId: randomUUID(), result: 'Second answer' });
  const other = await h.call(owner, 'chatgptBrowser:connect', { boardId, conversationId: hash('chrome:chat-2') });
  const secondChat = await save({ ...update, key: other.key });
  expect(secondChat.cardId).not.toBe(first.cardId);
  const board = await h.call(viewer, 'boards:read', scope(), 'query');
  expect(board.nodes.filter((node: any) => node.chatgptSynced)).toHaveLength(2);
  expect(JSON.stringify(board)).not.toContain('First answer');
  const read = { ...scope(), nodeKey: first.cardId, limit: 10 };
  await expect(h.call({}, 'agentContext:read', read, 'query')).rejects.toThrow('Sign in');
  expect((await h.call(viewer, 'agentContext:read', read, 'query')).items.map((item: any) => item.result))
    .toEqual(['Second answer', 'First answer']);
  await h.call(owner, 'chatgptBrowser:disconnectBoard', { boardId });
  await expect(save({ ...update, updateId: randomUUID() })).rejects.toThrow('chrome_sync_disconnected');
  expect((await h.call(viewer, 'agentContext:read', read, 'query')).items).toHaveLength(2);
  await h.pg.exec('set role authenticated');
  try {
    await expect(h.pg.query('select * from branch_private.chatgpt_updates')).rejects.toThrow(/permission denied/);
  } finally { await h.pg.exec('reset role'); }
});

it('binds desktop approvals to a board, separates browser keys and revokes desktop writes', async () => {
  const conversationId = hash('same underlying ChatGPT chat');
  const key = `branch_desktop_${Date.now() + 60_000}_${'3'.repeat(64)}`;
  const connect = { boardId, conversationId, keyHash: hash(key) };
  const update = { key, updateId: randomUUID(), title: 'Desktop chat', result: 'A completed desktop reply' };
  const desktopSave = (args: object) => h.engine.call('chatgptBrowser:save', { ...args, source: 'desktop' }, {}, 'mutation', true);
  await expect(desktopSave(update)).rejects.toThrow('chrome_sync_disconnected');
  await expect(h.call(viewer, 'chatgptBrowser:connectDesktop', connect)).rejects.toThrow('Board access denied');
  const browser = await h.call(owner, 'chatgptBrowser:connect', { boardId, conversationId });
  await h.call(owner, 'chatgptBrowser:connectDesktop', connect);
  await expect(desktopSave({ ...update, key: browser.key })).rejects.toThrow('chrome_sync_disconnected');
  await expect(h.engine.call('chatgptBrowser:save', update, {}, 'mutation', true)).rejects.toThrow('chrome_sync_disconnected');

  const first = await desktopSave(update);
  expect(await desktopSave(update)).toEqual(first);
  expect(await desktopSave({ ...update, updateId: randomUUID(), result: 'The next reply' })).toEqual(first);
  const chrome = await h.engine.call('chatgptBrowser:save', { ...update, key: browser.key }, {}, 'mutation', true);
  expect(chrome.cardId).not.toBe(first.cardId);
  const otherBoard = await h.call(owner, 'library:create', { title: 'Other desktop board' });
  await expect(h.call(owner, 'chatgptBrowser:connectDesktop', { ...connect, boardId: otherBoard }))
    .rejects.toThrow('This pairing was already used');
  expect(await h.engine.call('chatgptBrowser:stop', { key, source: 'desktop' }, {}, 'mutation', true)).toEqual({});
  await expect(desktopSave({ ...update, updateId: randomUUID() })).rejects.toThrow('chrome_sync_disconnected');
  const saved = await h.call(owner, 'agentContext:read', { ...scope(), nodeKey: first.cardId, limit: 10 }, 'query');
  expect(saved.items.map((item: any) => item.result)).toEqual(['The next reply', update.result]);

  const expired = `branch_desktop_${Date.now() - 1000}_${'4'.repeat(64)}`;
  await h.call(owner, 'chatgptBrowser:connectDesktop', { ...connect, keyHash: hash(expired) });
  await expect(desktopSave({ ...update, key: expired })).rejects.toThrow('chrome_sync_disconnected');
});

it('consumes one board-scoped launch ticket after an editor initiates Mac sync', async () => {
  const firstBoard = await h.call(owner, 'library:create', { title: 'Launch board' });
  const otherBoard = await h.call(owner, 'library:create', { title: 'Other launch board' });
  const conversationId = hash('A desktop launch conversation');
  const key = `branch_desktop_${Date.now() + 60_000}_${'5'.repeat(64)}`;
  const start = { boardId: firstBoard };
  await h.call(owner, 'sharing:addMember', { ...start, username: 'context-viewer', role: 'viewer' });
  await expect(h.call(viewer, 'chatgptBrowser:startDesktop', start)).rejects.toThrow('Board access denied');
  const { ticket } = await h.call(owner, 'chatgptBrowser:startDesktop', start);
  const redeem = (values: object) => h.engine.call('chatgptBrowser:redeemDesktop', values, {}, 'mutation', true);
  const status = () => h.engine.call('chatgptBrowser:status', { key, source: 'desktop' }, {}, 'query', true);
  const request = { ...start, ticket, conversationId, key };

  expect(await h.call(owner, 'chatgptBrowser:count', start, 'query')).toBe(0);
  await expect(status()).rejects.toThrow('chrome_sync_disconnected');
  await expect(redeem({ ...request, boardId: otherBoard })).rejects.toThrow('chrome_sync_disconnected');
  await expect(h.call(owner, 'chatgptBrowser:redeemDesktop', request)).rejects.toThrow('Unknown operation');
  const [first, replay] = await Promise.allSettled([redeem(request), redeem(request)]);
  expect([first.status, replay.status].sort()).toEqual(['fulfilled', 'rejected']);
  expect(await status()).toEqual({ boardId: firstBoard, boardTitle: 'Launch board' });
  expect(await h.call(owner, 'chatgptBrowser:count', start, 'query')).toBe(1);
  const update = { key, source: 'desktop', updateId: randomUUID(), title: 'Connected chat', result: 'A new completed reply' };
  const saved = await h.engine.call('chatgptBrowser:save', update, {}, 'mutation', true);
  const context = await h.call(owner, 'agentContext:read', { ...start, token: '', nodeKey: saved.cardId, limit: 10 }, 'query');
  expect(context.items.map((item: any) => item.result)).toEqual([update.result]);

  const pending = await h.call(owner, 'chatgptBrowser:startDesktop', start);
  await h.call(owner, 'chatgptBrowser:disconnectBoard', start);
  await expect(redeem({ ...request, ticket: pending.ticket })).rejects.toThrow('chrome_sync_disconnected');
  await expect(status()).rejects.toThrow('chrome_sync_disconnected');
});

it('delivers only approved coding handoffs, keeps drafts private, and publishes a result note', async () => {
  const nodeKey = 'coding-source';
  const args = { ...scope(), nodeKey };
  await h.call(owner, 'boards:patchNodes', { ...scope(), changes: [{
    id: nodeKey, create: { type: 'plan', title: 'Shared brief', body: 'Keep the board context scoped.', x: 32, y: 32, width: 380 },
  }] });
  const { fingerprint } = await h.call(owner, 'coding:preview', args, 'query');
  const handoff = await h.call(owner, 'coding:create', { ...args, fingerprint, sources: [], oneTime: true });
  const code = 'branch_handoff_' + '7'.repeat(64);
  const call = (name: string, values: object = {}) => codingRequest(new Request('http://localhost:4390/api/backend?coding', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + code, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { handoffId: handoff.id, ...values } } }),
  }), h.engine);
  expect((await call('read_card_handoff')).status).toBe(401);
  await h.call(owner, 'coding:approve', { ...args, handoffId: handoff.id, approvalHash: hash(code) });
  const read = await (await call('read_card_handoff')).json();
  expect(JSON.parse(read.result.content[0].text).text).toContain('Keep the board context scoped.');
  const returned = await (await call('return_card_draft', { text: '# Implementation\n\nVerified in tests.' })).json();
  expect(returned.result.content[0].text).toContain('Draft saved.');
  const afterReturn = await (await call('read_card_handoff')).json();
  expect(afterReturn.result.isError).toBe(true);
  await expect(h.call(viewer, 'coding:draft', args, 'query')).rejects.toThrow('Board access denied');
  const privateBoard = await h.call(viewer, 'boards:read', scope(), 'query');
  expect(JSON.stringify(privateBoard)).not.toContain('Verified in tests.');
  const noteKey = await h.call(owner, 'coding:resolve', { ...args, handoffId: handoff.id, publish: true });
  const shared = await h.call(viewer, 'boards:read', scope(), 'query');
  expect(shared.nodes.find((node: any) => node.id === noteKey)).toMatchObject({
    title: 'Implementation', body: '# Implementation\n\nVerified in tests.',
    codingNote: { sourceKey: nodeKey, handoffId: handoff.id },
  });
  expect((await call('read_card_handoff')).status).toBe(401);
});
