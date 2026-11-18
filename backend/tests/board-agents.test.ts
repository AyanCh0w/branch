import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as Y from 'yjs';
import { harness } from './harness';
import { boardAgentRequest } from '../board-agent-http';
import { loadDocument } from '../functions/documents';

let h: Awaited<ReturnType<typeof harness>>;
let owner: Awaited<ReturnType<typeof h.account>>;
let editor: typeof owner;
let viewer: typeof owner;
let boardId: string;
let otherBoard: string;
const scope = () => ({ boardId, token: '' });
const url = new URL('http://127.0.0.1:4387/api/backend?agent=1');

beforeAll(async () => {
  h = await harness();
  owner = await h.account('agent-board-owner');
  editor = await h.account('agent-board-editor');
  viewer = await h.account('agent-board-viewer');
  boardId = await h.call(owner, 'library:create', { title: 'Product board' });
  otherBoard = await h.call(owner, 'library:create', { title: 'Other board' });
  await h.call(owner, 'sharing:addMember', { boardId, username: 'agent-board-editor', role: 'editor' });
  await h.call(owner, 'sharing:addMember', { boardId, username: 'agent-board-viewer', role: 'viewer' });
  await h.call(owner, 'boards:patchNodes', { token: '', boardId: otherBoard, changes: [{
    id: 'other-board-note', create: { type: 'plan', title: 'Other board note', body: 'Other board text', x: 0, y: 0, width: 380 },
  }] });
});
afterAll(() => h?.close());

// The test client reports `client` as its MCP clientInfo name, which Branch uses to label the connection.
async function openAgent(person: typeof owner, name: string, mode = 'edit', clientName = name) {
  const grant = await h.call(person, 'boardAgents:connect', { ...scope(), name, mode });
  return { ...grant, ...await connectClient(grant.code, clientName) };
}

async function connectClient(code: string, clientName: string) {
  const client = new Client({ name: clientName, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: 'Bearer ' + code } },
    fetch: async (input, init) => boardAgentRequest(new Request(input, init), h.engine),
  });
  await client.connect(transport);
  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content as Array<{ type: string; text: string }>)[0];
    if (result.isError) throw new Error(content.text);
    return JSON.parse(content.text);
  }
  return { client, call };
}

const connections = async (person: typeof owner) =>
  (await h.call(person, 'boardAgents:settings', scope(), 'query'));

it('shares project instructions and routes updates and cards from two connections to the right board', async () => {
  const notify = vi.fn(async () => {});
  h.engine.notifyChanges = notify;
  const instructions = '# Build the issue tracker\nUse the shared API contract.';
  await expect(h.call(viewer, 'boardAgents:connect', { ...scope(), name: 'Viewer agent', mode: 'edit' }))
    .rejects.toThrow('Board access denied');
  await h.call(owner, 'boardAgents:saveInstructions', { ...scope(), text: instructions, expectedVersion: 0 });
  await expect(h.call(editor, 'boardAgents:saveInstructions', { ...scope(), text: 'Outdated', expectedVersion: 0 }))
    .rejects.toThrow('instructions changed');
  const planner = await openAgent(owner, 'API planner');
  const builder = await openAgent(editor, 'UI builder');
  try {
    const board = await planner.call('read_board');
    expect(board).toMatchObject({ boardId, instructions: { text: instructions, version: 1 } });
    const workflow = planner.client.getInstructions();
    expect(workflow).toBe(board.agentInstructions);
    expect(workflow).toContain('Do not open Chrome or use screen control');
    expect(workflow).toContain('Before sending every assistant message');
    expect(workflow).toContain('call publish_update');
    expect(workflow).toContain('progress messages, questions, and final replies');
    const publish = (await planner.client.listTools()).tools.find(tool => tool.name === 'publish_update');
    expect(publish?.description).toContain('Before every assistant message');
    await expect(planner.call('read_card', { nodeKey: 'other-board-note' })).rejects.toThrow('unavailable on this board');
    const note = { requestId: 'api-contract', title: 'API contract', body: 'GET /issues returns a list.' };
    const card = await planner.call('create_card', note);
    expect(await planner.call('create_card', note)).toEqual(card);
    await expect(planner.call('create_card', { ...note, body: 'Conflicting retry' })).rejects.toThrow('new request ID');
    expect((await h.call(viewer, 'boards:read', scope(), 'query')).nodes)
      .toContainEqual(expect.objectContaining({ id: card.id, body: note.body }));
    notify.mockClear();
    const update = { requestId: 'ready', title: 'API contract ready', result: 'The UI can now use the contract.', nodeKey: card.id };
    const published = await planner.call('publish_update', update);
    expect(await planner.call('publish_update', update)).toEqual(published);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      boards: [boardId], collections: expect.arrayContaining(['boardAgentUpdates', 'boardAgentConnections']),
    }));
    expect((await builder.call('read_context')).items).toMatchObject([{ id: published.id, author: 'API planner', nodeKey: card.id }]);
    await builder.call('publish_update', { ...update, title: 'UI started' });
    const sources = await h.call(viewer, 'boardAgents:sources', scope(), 'query');
    expect(sources.map(source => source.name)).toEqual(['API planner', 'UI builder']);
    const timeline = await h.call(viewer, 'boardAgents:activity', { ...scope(), connectionId: planner.id, limit: 10 }, 'query');
    expect(timeline.items).toMatchObject([{ id: published.id, result: update.result }]);
    await expect(h.call({}, 'boardAgents:activity', { ...scope(), connectionId: planner.id, limit: 10 }, 'query'))
      .rejects.toThrow('Sign in');
    expect((await h.call(owner, 'boardAgents:activity', { token: '', boardId: otherBoard, connectionId: planner.id, limit: 10 }, 'query')).items)
      .toEqual([]);
    expect(JSON.stringify(await h.call(owner, 'boardAgents:settings', scope(), 'query'))).not.toContain(planner.code);
  } finally {
    await planner.client.close();
    await builder.client.close();
    h.engine.notifyChanges = undefined;
  }
});

it('protects edits with ownership, human changes and version checks, and makes proposals reviewable', async () => {
  const first = await openAgent(owner, 'Architecture');
  const second = await openAgent(owner, 'Frontend');
  const readOnly = await openAgent(owner, 'Observer', 'read');
  try {
    expect((await readOnly.client.listTools()).tools.map(tool => tool.name))
      .toEqual(['read_board', 'read_card', 'read_context']);
    const observerBoard = await readOnly.call('read_board');
    expect(observerBoard.agentInstructions).toBe(readOnly.client.getInstructions());
    expect(observerBoard.agentInstructions).toContain('This connection is read only');
    expect(observerBoard.agentInstructions).not.toContain('call publish_update');
    expect(observerBoard.agentInstructions).toContain('Do not use Chrome or screen control');
    await expect(readOnly.call('create_card', { requestId: 'readonly', title: 'Forbidden', body: '' })).rejects.toThrow();
    const card = await first.call('create_card', { requestId: 'architecture', title: 'Architecture', body: 'Initial proposal' });
    const patch = { nodeKey: card.id, expectedVersion: 0, title: 'Architecture', body: 'Agent revision' };
    await expect(second.call('update_card', patch)).rejects.toThrow('propose_edit');
    expect(await first.call('update_card', patch)).toMatchObject({ version: 1 });
    await expect(first.call('update_card', patch)).rejects.toThrow('card changed');

    const proposal = { ...patch, expectedVersion: 1, requestId: 'review', body: 'Suggest pagination', summary: 'Add pagination to the API.' };
    const { id } = await second.call('propose_edit', proposal);
    expect((await first.call('read_card', { nodeKey: card.id })).text).toBe('Agent revision');
    await expect(h.call(viewer, 'boardAgents:review', { ...scope(), updateId: id, apply: true })).rejects.toThrow('Board access denied');
    const edited = (await h.call(owner, 'boards:read', scope(), 'query')).nodes.find(node => node.id === card.id);
    const doc = loadDocument(edited.sharedTextState);
    const state = Y.encodeStateVector(doc);
    doc.getText('body').insert(0, 'Human edit. ');
    const delta = Uint8Array.from(Y.encodeStateAsUpdate(doc, state)).buffer;
    doc.destroy();
    await h.call(owner, 'collaboration:updateText', { ...scope(), nodeKey: card.id, update: delta, tabId: 'human-tab', epoch: 0 });
    await expect(h.call(owner, 'boardAgents:review', { ...scope(), updateId: id, apply: true })).rejects.toThrow('card changed');
    await expect(first.call('update_card', { ...patch, expectedVersion: 2 })).rejects.toThrow('teammate edited');
    const fresh = await second.call('propose_edit', { ...proposal, requestId: 'review-v2', expectedVersion: 2, body: 'Human edit. Suggest pagination.' });
    expect(await h.call(owner, 'boardAgents:review', { ...scope(), updateId: fresh.id, apply: true })).toEqual({ status: 'applied' });
    expect(await second.call('propose_edit', { ...proposal, requestId: 'review-v2', expectedVersion: 2, body: 'Human edit. Suggest pagination.' })).toEqual(fresh);
    expect(await first.call('read_card', { nodeKey: card.id })).toMatchObject({ text: 'Human edit. Suggest pagination.', version: 3 });
  } finally {
    await first.client.close();
    await second.client.close();
    await readOnly.client.close();
  }
});

it('stops remote calls after a connection is revoked or its creator loses edit access', async () => {
  const agent = await openAgent(editor, 'Editor connection');
  try {
    const membership = (await h.call(owner, 'sharing:settings', { boardId }, 'query')).members
      .find(member => member.userId === editor.userId);
    await h.call(owner, 'sharing:changeMemberRole', { memberId: membership.id, role: 'viewer' });
    await expect(agent.call('read_board')).rejects.toMatchObject({ code: 401 });
    await h.call(owner, 'boardAgents:disconnect', { ...scope(), connectionId: agent.id });
    await h.call(owner, 'sharing:changeMemberRole', { memberId: membership.id, role: 'editor' });
    await expect(agent.call('publish_update', { requestId: 'revoked', title: 'Forbidden', result: 'Forbidden' }))
      .rejects.toMatchObject({ code: 401 });
  } finally { await agent.client.close(); }
});

it('lists a copied key only after a client uses it, named after the client and its owner', async () => {
  const before = await connections(owner);
  const unused = await h.call(owner, 'boardAgents:connect', { ...scope(), name: 'Board agent 1', mode: 'edit' });
  const copiedAgain = await h.call(owner, 'boardAgents:connect', { ...scope(), name: 'Board agent 2', mode: 'edit' });
  let settings = await connections(owner);
  expect(settings.connections).toEqual(before.connections);
  expect(settings.unusedKeys).toBe(before.unusedKeys + 2);

  const claude = await connectClient(unused.code, 'claude-ai');
  const chatgpt = await connectClient(copiedAgain.code, 'openai-mcp');
  const secondClaude = await openAgent(editor, 'Board agent 3', 'read', 'claude-ai');
  try {
    settings = await connections(owner);
    expect(settings.unusedKeys).toBe(before.unusedKeys);
    const added = settings.connections.slice(before.connections.length);
    expect(added).toMatchObject([
      { id: unused.id, name: 'Claude', client: 'Claude', owner: 'You', mode: 'edit' },
      { id: copiedAgain.id, name: 'ChatGPT', client: 'ChatGPT', owner: 'You', mode: 'edit' },
      { id: secondClaude.id, name: 'Claude 2', client: 'Claude', owner: 'agent-board-editor', mode: 'read' },
    ]);
    const editorView = (await connections(editor)).connections;
    expect(editorView.find(c => c.id === secondClaude.id)).toMatchObject({ owner: 'You' });
    expect(editorView.map(c => c.id)).not.toContain(unused.id);
    expect((await claude.call('read_board')).agent).toBe('Claude');
    await claude.call('publish_update', { requestId: 'labelled', title: 'Started', result: 'Reading the board.' });
    expect((await chatgpt.call('read_context')).items[0]).toMatchObject({ author: 'Claude' });
    expect((await h.call(viewer, 'boardAgents:sources', scope(), 'query')))
      .toContainEqual(expect.objectContaining({ id: unused.id, name: 'Claude', owner: 'agent-board-owner' }));
    // Reconnecting with another client name keeps the first label.
    const renamed = await connectClient(unused.code, 'codex-mcp-client');
    await renamed.client.close();
    expect((await connections(owner)).connections.find(c => c.id === unused.id).name).toBe('Claude');
  } finally {
    await claude.client.close();
    await chatgpt.client.close();
    await secondClaude.client.close();
    for (const { id } of [unused, copiedAgain, secondClaude]) {
      await h.call(owner, 'boardAgents:disconnect', { ...scope(), connectionId: id });
    }
  }
});

it('expires unused keys after a day and revokes unused keys on request', async () => {
  const stale = await h.call(owner, 'boardAgents:connect', { ...scope(), name: 'Board agent 1', mode: 'edit' });
  const waiting = await h.call(owner, 'boardAgents:connect', { ...scope(), name: 'Board agent 2', mode: 'edit' });
  const legacy = await h.call(owner, 'boardAgents:connect', { ...scope(), name: 'Board agent 3', mode: 'edit' });
  const active = await openAgent(owner, 'Active', 'edit', 'gemini-cli-mcp-client');
  const unusedBefore = (await connections(owner)).unusedKeys;
  await h.pg.query('update branch_private.board_agent_connections set expires_at=$2 where id=$1', [stale.id, Date.now() - 1]);
  // Keys created before expiry existed have no expiresAt and keep working.
  await h.pg.query('update branch_private.board_agent_connections set expires_at=null where id=$1', [legacy.id]);
  try {
    expect((await connections(owner)).unusedKeys).toBe(unusedBefore - 1);
    await expect(connectClient(stale.code, 'claude-ai')).rejects.toThrow();
    const old = await connectClient(legacy.code, 'Some Custom Agent!');
    await old.client.close();
    expect((await connections(owner)).connections).toContainEqual(expect.objectContaining({ id: legacy.id, name: 'Some Custom Agent' }));
    // Keys whose client reports no name are numbered when they connect, even if the dialog reused a placeholder.
    const unnamed = await Promise.all([1, 2].map(() =>
      h.call(owner, 'boardAgents:connect', { ...scope(), name: 'Board agent 1', mode: 'read' })));
    for (const { code } of unnamed) await (await connectClient(code, '***')).client.close();
    const listed = (await connections(owner)).connections;
    expect(unnamed.map(({ id }) => listed.find(c => c.id === id))).toMatchObject([
      { name: 'Board agent 1', client: null }, { name: 'Board agent 2', client: null },
    ]);
    for (const { id } of unnamed) await h.call(owner, 'boardAgents:disconnect', { ...scope(), connectionId: id });
    expect(await h.call(owner, 'boardAgents:revokeUnused', scope())).toEqual({ revoked: 1 });
    await expect(connectClient(waiting.code, 'claude-ai')).rejects.toThrow();
    expect((await connections(owner)).unusedKeys).toBe(0);
    expect((await active.call('read_board')).agent).toBe('Gemini');
    await expect(h.call(viewer, 'boardAgents:revokeUnused', scope())).rejects.toThrow('Board access denied');
  } finally {
    await active.client.close();
    for (const { id } of [legacy, active]) await h.call(owner, 'boardAgents:disconnect', { ...scope(), connectionId: id });
  }
});
