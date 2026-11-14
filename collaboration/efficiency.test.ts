// Guards the database-cost design: typing and streaming must not rewrite the
// board's card records, and the board's "last changed" time is throttled.
import { convexTest } from 'convex-test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import { loadDocument } from '../convex/documents';
import { TOUCH_MS } from '../convex/access';

const modules = import.meta.glob('../convex/**/*.ts');
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

async function setup() {
  vi.stubEnv('DEV_BRIDGE_SECRET', 'efficiency'); vi.stubEnv('ENABLE_DEVELOPMENT_BRIDGE', 'true');
  const t = convexTest(schema, modules);
  const session = await t.mutation(api.boards.developmentSession, { secret: 'efficiency', identityKey: 'alice', token: 'alice-token' });
  const auth = { token: 'alice-token', boardId: session.boardId };
  await t.mutation(api.boards.initialize, { ...auth, title: 'Board', nodes: [
    { id: 'note', type: 'plan', title: 'Note', body: 'Hello', x: 0, y: 0 },
    { id: 'chat', type: 'thread', title: 'Chat', draft: 'Question', messages: [], contexts: [], x: 600, y: 0 },
  ] });
  const node = (key: string) => t.run(ctx => ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', session.boardId).eq('key', key)).unique());
  const type = async (key: string, field: string, text: string) => {
    const current = await t.query(api.collaboration.text, { ...auth, nodeKey: key });
    const doc = loadDocument(current!.textState), vector = Y.encodeStateVector(doc);
    doc.getText(field).insert(doc.getText(field).length, text);
    return t.mutation(api.collaboration.updateText, { ...auth, nodeKey: key, update: Uint8Array.from(Y.encodeStateAsUpdate(doc, vector)).buffer, tabId: 'tab', epoch: 0 });
  };
  return { t, auth, node, type };
}

describe('database cost', () => {
  it('stores typed text outside the card record and serves it per card', async () => {
    const { t, auth, node, type } = await setup();
    const before = await node('note');
    expect(await type('note', 'body', ' world')).toEqual({ version: 1 });
    expect(await type('note', 'body', '!')).toEqual({ version: 2 });
    // The card record (which the live board feed reads) is untouched by typing.
    const after = await node('note');
    expect(after!._creationTime).toBe(before!._creationTime);
    expect(after!.textVersion).toBe(0);
    expect(JSON.stringify(after!.data)).toEqual(JSON.stringify(before!.data));
    // Text and version come from the text table everywhere they're read.
    const text = await t.query(api.collaboration.text, { ...auth, nodeKey: 'note' });
    expect(text!.version).toBe(2);
    const full = (await t.query(api.boards.read, auth)).nodes.find(n => n.id === 'note')!;
    expect(full).toMatchObject({ body: 'Hello world!', sharedVersion: 2 });
    const live = (await t.query(api.boards.live, auth)).nodes.find(n => n.id === 'note')!;
    expect(live).not.toHaveProperty('sharedTextState');
    expect(live).not.toHaveProperty('body');
  });

  it('sends with the text-table version and clears the draft there', async () => {
    const { t, auth, type } = await setup();
    await t.mutation(api.collaboration.focus, { ...auth, nodeKey: 'chat', field: 'draft', tabId: 'tab' });
    await type('chat', 'draft', ' please');
    await expect(t.mutation(api.chat.send, { ...auth, nodeKey: 'chat', requestId: 'stale', expectedVersion: 0 })).rejects.toThrow(/draft changed/);
    const runId = await t.mutation(api.chat.send, { ...auth, nodeKey: 'chat', requestId: 'fresh', expectedVersion: 1 });
    const run = await t.run(ctx => ctx.db.get(runId));
    expect(run!.input.messages.at(-1).content).toBe('Question please');
    expect((await t.query(api.collaboration.text, { ...auth, nodeKey: 'chat' }))!.version).toBe(2);
    expect((await t.query(api.boards.read, auth)).nodes.find(n => n.id === 'chat')!.draft).toBe('');
  });

  it('streams replies through the run and writes the card once when done', async () => {
    const { t, auth, node } = await setup();
    const runId = await t.mutation(api.chat.send, { ...auth, nodeKey: 'chat', requestId: 'ask', expectedVersion: 0 });
    await t.mutation(internal.chat.claim, { runId });
    const before = JSON.stringify((await node('chat'))!.data);
    await t.mutation(internal.chat.append, { runId, text: 'Part one, ', activity: 'writing' });
    await t.mutation(internal.chat.append, { runId, text: 'part two.' });
    expect(JSON.stringify((await node('chat'))!.data)).toBe(before);
    expect(await t.query(api.chat.stream, { ...auth, nodeKey: 'chat' })).toMatchObject({ text: 'Part one, part two.', activity: 'writing', assistantId: 'ask-assistant' });
    await t.mutation(internal.chat.append, { runId, text: '', done: true });
    const chat = (await t.query(api.boards.read, auth)).nodes.find(n => n.id === 'chat')!;
    expect(chat.messages.at(-1).text).toBe('Part one, part two.');
    expect(chat.activeRun).toBeUndefined();
    expect(await t.query(api.chat.stream, { ...auth, nodeKey: 'chat' })).toBeNull();
    expect((await t.run(ctx => ctx.db.get(runId)))!.streamText).toBeUndefined();
  });

  it('keeps streamed text when a reply is stopped', async () => {
    const { t, auth } = await setup();
    const runId = await t.mutation(api.chat.send, { ...auth, nodeKey: 'chat', requestId: 'ask', expectedVersion: 0 });
    await t.mutation(internal.chat.claim, { runId });
    await t.mutation(internal.chat.append, { runId, text: 'Half an answer' });
    await t.mutation(api.chat.stop, { ...auth, nodeKey: 'chat' });
    expect((await t.query(api.boards.read, auth)).nodes.find(n => n.id === 'chat')!.messages.at(-1).text).toBe('Half an answer');
  });

  it('updates the board’s last-changed time at most once a minute', async () => {
    vi.useFakeTimers();
    const { t, auth } = await setup();
    const updatedAt = async () => (await t.run(ctx => ctx.db.get(auth.boardId)))!.updatedAt;
    vi.advanceTimersByTime(TOUCH_MS + 1);
    await t.mutation(api.boards.patchNodes, { ...auth, changes: [{ id: 'note', patch: { x: 5 } }] });
    const first = await updatedAt();
    vi.advanceTimersByTime(1000);
    await t.mutation(api.boards.patchNodes, { ...auth, changes: [{ id: 'note', patch: { x: 6 } }] });
    expect(await updatedAt()).toBe(first);
    vi.advanceTimersByTime(TOUCH_MS);
    await t.mutation(api.boards.patchNodes, { ...auth, changes: [{ id: 'note', patch: { x: 7 } }] });
    expect(await updatedAt()).toBeGreaterThan(first!);
  });
});
