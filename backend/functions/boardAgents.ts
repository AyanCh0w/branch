import { internalMutation, internalQuery, mutation, query } from '../definitions';
import { v } from '../validation';
import { access, accessForUser, tokenHash } from './access';
import { encodeDocument, initialDocument, loadDocument, readText } from './documents';
import { textOf } from '../../app/context.js';
import { place } from '../../app/auto-layout.js';
import { agentWorkflow } from '../agent-workflow';
import { clientLabel, cleanClientName } from '../board-agent-clients';
import { deliverBrief, implicitConnection, logResearch, recordDecision, resolvePlanKey, saveCard, savePlan, saveSource, updateCard as revisePlanCardText, type Actor } from './planning';

const scope = { boardId: v.id('boards'), token: v.string() };
const key = { keyHash: v.string() };
const request = { ...key, requestId: v.string() };
const noteFields = { title: v.string(), body: v.string() };
const editFields = { nodeKey: v.string(), expectedVersion: v.number(), ...noteFields };

// Distinguish user-facing failures from infrastructure and database errors.
export class BoardAgentError extends Error {}
const denied = () => new BoardAgentError('The agent connection is unavailable or its board access was removed.');
// A copied setup key that no client has used yet stops working after this long.
export const SETUP_KEY_TTL = 24 * 60 * 60 * 1000;
const unused = (connection: any) => !connection.revoked && !connection.connectedAt;
const expired = (connection: any, now = Date.now()) => unused(connection) && !!connection.expiresAt && connection.expiresAt <= now;

function text(value: string, label: string, limit: number, allowEmpty = false) {
  const trimmed = value.trim();
  if (trimmed.length > limit || (!allowEmpty && !trimmed)) {
    throw new BoardAgentError(`${label} must be ${allowEmpty ? 'at most' : 'between 1 and'} ${limit} characters.`);
  }
  return trimmed;
}

function operationId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
    throw new BoardAgentError('Use a request ID of 1–100 letters, numbers, dashes or underscores.');
  }
  return value;
}

function pageSize(value: number, max: number) {
  return Math.max(1, Math.min(max, Math.floor(value)));
}

async function signedInEditor(ctx: any, args: { boardId: string; token: string }) {
  const permission = await access(ctx, args.token, args.boardId, true);
  if ((await ctx.db.get(permission.userId))?.kind !== 'account') {
    throw new BoardAgentError('Sign in to a Branch account to manage agents.');
  }
  return permission;
}

async function connectionFor(ctx: any, keyHash: string, edit = false) {
  const connection = await ctx.db.query('boardAgentConnections')
    .withIndex('key', q => q.eq('keyHash', keyHash)).unique();
  if (!connection || connection.revoked || expired(connection) || (edit && connection.mode !== 'edit')) throw denied();
  if ((await ctx.db.get(connection.userId))?.kind !== 'account') throw denied();
  try {
    const { board } = await accessForUser(ctx, connection.userId, connection.boardId, connection.mode === 'edit');
    return { connection, board };
  } catch (error) {
    if (error instanceof Error && ['Board not found', 'Board access denied'].includes(error.message)) throw denied();
    throw error;
  }
}

const instructionsFor = (ctx: any, boardId: string) => ctx.db.query('boardAgentInstructions')
  .withIndex('board', q => q.eq('boardId', boardId)).unique();
const cardFor = async (ctx: any, boardId: string, nodeKey: string) => {
  const card = await ctx.db.query('nodes')
    .withIndex('board_key', q => q.eq('boardId', boardId).eq('key', nodeKey)).unique();
  if (!card || card.deleted) throw new BoardAgentError('Card is unavailable on this board.');
  return card;
};

function cardText(card: any) {
  const doc = loadDocument(card.textState);
  try { return readText(doc); } finally { doc.destroy(); }
}

async function requireCurrentNote(ctx: any, card: any, expectedVersion: number) {
  if (card.deleted || card.chatgptSynced || card.codingNote || card.data.type !== 'plan') {
    throw new BoardAgentError('Choose an editable note card.');
  }
  if (card.textVersion !== expectedVersion) throw new BoardAgentError('This card changed. Read it again before editing.');
  const editors = await ctx.db.query('editors')
    .withIndex('node', q => q.eq('boardId', card.boardId).eq('nodeKey', card.key)).collect();
  if (editors.some(editor => editor.expiresAt > Date.now())) {
    throw new BoardAgentError('Someone is editing this card. Try again after they finish.');
  }
}

async function writeNote(ctx: any, card: any, title: string, body: string, userId: string) {
  const doc = loadDocument(card.textState);
  try {
    doc.transact(() => {
      for (const [field, value] of [['title', title], ['body', body]]) {
        const target = doc.getText(field);
        if (target.toString() === value) continue;
        target.delete(0, target.length);
        target.insert(0, value);
      }
    });
    const version = card.textVersion + 1;
    await ctx.db.patch(card._id, {
      data: { ...card.data, title, body }, textState: encodeDocument(doc), textVersion: version, updatedBy: userId,
    });
    await ctx.db.patch(card.boardId, { updatedAt: Date.now() });
    return { id: card.key, version };
  } finally { doc.destroy(); }
}

const ownerName = async (ctx: any, userId: string) => (await ctx.db.get(userId))?.name || 'Unknown';

async function manageable(ctx: any, args: { boardId: string; token: string }) {
  const { userId, membership } = await signedInEditor(ctx, args);
  const rows = await ctx.db.query('boardAgentConnections').withIndex('board', q => q.eq('boardId', args.boardId)).collect();
  return { userId, rows: rows.filter(c => !c.revoked && (c.userId === userId || membership.role === 'owner')) };
}

export const settings = query({
  args: scope,
  handler: async (ctx, args) => {
    const [instructions, { userId, rows }] = await Promise.all([instructionsFor(ctx, args.boardId), manageable(ctx, args)]);
    const now = Date.now();
    // Only keys a client has used are connections; copied keys still waiting are counted, not listed.
    const connected = rows.filter(c => c.connectedAt).sort((a, b) => a.connectedAt - b.connectedAt);
    return {
      instructions: { text: instructions?.text || '', version: instructions?.version || 0 },
      connections: await Promise.all(connected.filter(c => !implicitConnection(c)).map(async c => ({
        id: c._id, name: c.name, mode: c.mode, client: clientLabel(c.client) || null,
        owner: c.userId === userId ? 'You' : await ownerName(ctx, c.userId), connectedAt: c.connectedAt,
      }))),
      unusedKeys: rows.filter(c => unused(c) && !expired(c, now)).length,
    };
  },
});

export const connect = mutation({
  args: { ...scope, name: v.string(), mode: v.union(v.literal('read'), v.literal('edit')) },
  handler: async (ctx, args) => {
    const { userId } = await signedInEditor(ctx, args);
    const name = text(args.name, 'Agent name', 80);
    const code = 'branch_agent_' + Array.from(crypto.getRandomValues(new Uint8Array(32)),
      byte => byte.toString(16).padStart(2, '0')).join('');
    const id = await ctx.db.insert('boardAgentConnections', {
      boardId: args.boardId, userId, name, keyHash: await tokenHash(code), mode: args.mode, revoked: false,
      expiresAt: Date.now() + SETUP_KEY_TTL,
    });
    return { id, code };
  },
});

export const disconnect = mutation({
  args: { ...scope, connectionId: v.id('boardAgentConnections') },
  handler: async (ctx, args) => {
    const { userId, membership } = await signedInEditor(ctx, args);
    const connection = await ctx.db.get(args.connectionId);
    if (connection?.boardId !== args.boardId || (connection.userId !== userId && membership.role !== 'owner')) {
      throw new BoardAgentError('You cannot disconnect this agent.');
    }
    await ctx.db.patch(connection._id, { revoked: true });
  },
});

// Revokes copied keys that no client has used, such as setups that were abandoned or shared by mistake.
export const revokeUnused = mutation({
  args: scope,
  handler: async (ctx, args) => {
    const { rows } = await manageable(ctx, args);
    const pending = rows.filter(c => unused(c));
    for (const connection of pending) await ctx.db.patch(connection._id, { revoked: true });
    return { revoked: pending.filter(c => !expired(c)).length };
  },
});

export const saveInstructions = mutation({
  args: { ...scope, text: v.string(), expectedVersion: v.number() },
  handler: async (ctx, args) => {
    await signedInEditor(ctx, args);
    const instructions = await instructionsFor(ctx, args.boardId);
    if ((instructions?.version || 0) !== args.expectedVersion) {
      throw new BoardAgentError('The project instructions changed. Reopen them before saving.');
    }
    const value = { text: text(args.text, 'Project instructions', 12_000, true), version: args.expectedVersion + 1 };
    if (instructions) await ctx.db.patch(instructions._id, value);
    else await ctx.db.insert('boardAgentInstructions', { boardId: args.boardId, ...value });
    return value;
  },
});

export const checkConnection = internalQuery({
  args: key,
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash);
    return { mode: connection.mode, connected: !!connection.connectedAt, identified: !!connection.client };
  },
});

// Called on a key's first use, and on an initialize request until the client has named itself.
export const activate = internalMutation({
  args: { ...key, client: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash);
    const patch: Record<string, unknown> = {};
    if (!connection.connectedAt) Object.assign(patch, { connectedAt: Date.now(), expiresAt: undefined });
    const client = cleanClientName(args.client);
    if (client && !connection.client) patch.client = client;
    // Name the connection after its client, numbered when the board already has one with that name.
    // A client that doesn't report a name gets the next free "Board agent N".
    const label = patch.client ? clientLabel(client) : patch.connectedAt ? 'Board agent' : undefined;
    if (label) {
      const rows = await ctx.db.query('boardAgentConnections')
        .withIndex('board', q => q.eq('boardId', connection.boardId)).collect();
      const taken = new Set(rows.filter(c => c._id !== connection._id && !c.revoked && c.connectedAt).map(c => c.name));
      const candidate = (n: number) => patch.client && n === 1 ? label : label + ' ' + n;
      let number = 1;
      while (taken.has(candidate(number))) number++;
      patch.name = candidate(number);
    }
    if (Object.keys(patch).length) await ctx.db.patch(connection._id, patch);
    return null;
  },
});

export const readBoard = internalQuery({
  args: { ...key, offset: v.number() },
  handler: async (ctx, args) => {
    const { board, connection } = await connectionFor(ctx, args.keyHash);
    const instructions = await instructionsFor(ctx, board._id);
    const offset = Math.max(0, Math.min(100_000, Math.floor(args.offset)));
    const size = 30;
    const { rows } = await ctx.db.sql.query(
      'select id from branch_private.nodes where board_id=$1 and not deleted order by created_at,id limit $2 offset $3',
      [board._id, size + 1, offset],
    );
    const cards = await Promise.all(rows.slice(0, size).map(async ({ id }) => {
      const card = await ctx.db.get(id);
      const role = card.data.visualPlan ? 'plan' : card.data.brief?.kind || (card.data.lane?.role === 'source' ? 'source' : undefined);
      return { id: card.key, title: cardText(card).title, kind: card.data.type, ...(role ? { role } : {}), version: card.textVersion };
    }));
    return {
      boardId: board._id, title: board.title, agent: connection.name, mode: connection.mode,
      agentInstructions: agentWorkflow(connection.mode),
      instructions: { text: instructions?.text || '', version: instructions?.version || 0 },
      cards, nextOffset: rows.length > size ? offset + size : null,
    };
  },
});

export const readCard = internalQuery({
  args: { ...key, nodeKey: v.string() },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash);
    const card = await cardFor(ctx, connection.boardId, args.nodeKey);
    const { title, body } = cardText(card);
    const source = textOf({ ...card.data, title, body });
    const ownership = await ctx.db.query('boardAgentCards').withIndex('node', q => q.eq('nodeId', card._id)).unique();
    return {
      id: card.key, kind: card.data.type, title, text: source.slice(0, 32_000), truncated: source.length > 32_000,
      // The reasoning an agent saved with a short canvas card.
      ...(card.data.brief?.detail ? { detail: String(card.data.brief.detail).slice(0, 32_000) } : {}),
      version: card.textVersion,
      canEdit: connection.mode === 'edit' && ownership?.connectionId === connection._id &&
        title === card.data.title && body === card.data.body,
    };
  },
});

export const createCard = internalMutation({
  args: { ...request, ...noteFields },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash, true);
    const { boardId, userId, name } = connection;
    const requestId = operationId(args.requestId);
    const title = text(args.title, 'Card title', 100);
    const body = text(args.body, 'Card text', 24_000, true);
    const fingerprint = await tokenHash(JSON.stringify([title, body]));
    const previous = await ctx.db.query('boardAgentCards')
      .withIndex('request', q => q.eq('connectionId', connection._id).eq('requestId', requestId)).unique();
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new BoardAgentError('Use a new request ID for a different card.');
      const card = await ctx.db.get(previous.nodeId);
      if (!card || card.deleted) throw new BoardAgentError('The original card was deleted.');
      return { id: card.key, version: card.textVersion };
    }
    const cards = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', boardId)).collect();
    const id = 'agent-' + crypto.randomUUID();
    const location = place(cards.filter(card => !card.deleted).map(card => card.data), { x: 600, y: 80 }, 380, 220);
    const data = { id, type: 'plan', title, body, ...location, width: 380, revision: 1, titleEdited: true, author: name };
    const nodeId = await ctx.db.insert('nodes', {
      boardId, key: id, data, textState: initialDocument(data), textVersion: 0,
      createdBy: userId, updatedBy: userId, deleted: false,
    });
    await ctx.db.insert('boardAgentCards', { boardId, connectionId: connection._id, nodeId, requestId, fingerprint });
    await ctx.db.patch(boardId, { updatedAt: Date.now() });
    return { id, version: 0 };
  },
});

export const updateCard = internalMutation({
  args: { ...key, ...editFields },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash, true);
    const card = await cardFor(ctx, connection.boardId, args.nodeKey);
    const owner = await ctx.db.query('boardAgentCards').withIndex('node', q => q.eq('nodeId', card._id)).unique();
    if (owner?.connectionId !== connection._id) throw new BoardAgentError('Use propose_edit for a card you did not create.');
    await requireCurrentNote(ctx, card, args.expectedVersion);
    const current = cardText(card);
    if (current.title !== card.data.title || current.body !== card.data.body) {
      throw new BoardAgentError('A teammate edited this card. Use propose_edit to keep their changes available for review.');
    }
    return writeNote(ctx, card, text(args.title, 'Card title', 100), text(args.body, 'Card text', 24_000, true), connection.userId);
  },
});

type Proposal = { nodeId: string; expectedVersion: number; title: string; body: string; status: string };

async function saveUpdate(ctx: any, connection: any, requestId: string, title: string, result: string,
  nodeKey?: string, proposal?: Proposal, currentVersion?: number) {
  const existing = await ctx.db.query('boardAgentUpdates')
    .withIndex('request', q => q.eq('connectionId', connection._id).eq('requestId', requestId)).unique();
  if (existing) {
    const old = existing.proposal;
    const sameProposal = old && proposal
      ? old.nodeId === proposal.nodeId && old.expectedVersion === proposal.expectedVersion &&
        old.title === proposal.title && old.body === proposal.body
      : !old && !proposal;
    if (existing.title !== title || existing.result !== result || existing.nodeKey !== nodeKey || !sameProposal) {
      throw new BoardAgentError('Use a new request ID for a different update.');
    }
    return { id: existing._id };
  }
  if (proposal && currentVersion !== proposal.expectedVersion) {
    throw new BoardAgentError('This card changed. Read it again before proposing an edit.');
  }
  if (!proposal && nodeKey !== undefined) await cardFor(ctx, connection.boardId, nodeKey);
  const id = await ctx.db.insert('boardAgentUpdates', {
    boardId: connection.boardId, connectionId: connection._id, requestId, agentName: connection.name,
    title, result, nodeKey, proposal,
  });
  await ctx.db.patch(connection._id, { lastUpdateAt: Date.now() });
  return { id };
}

export const publish = internalMutation({
  args: { ...request, title: v.string(), result: v.string(), nodeKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash, true);
    return saveUpdate(ctx, connection, operationId(args.requestId), text(args.title, 'Update title', 120),
      text(args.result, 'Update', 8_000), args.nodeKey);
  },
});

export const propose = internalMutation({
  args: { ...request, ...editFields, summary: v.string() },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash, true);
    const card = await cardFor(ctx, connection.boardId, args.nodeKey);
    if (card.chatgptSynced || card.codingNote || card.data.type !== 'plan') {
      throw new BoardAgentError('Choose an editable note card.');
    }
    return saveUpdate(ctx, connection, operationId(args.requestId), 'Proposed edit',
      text(args.summary, 'Change summary', 2_000), card.key, {
        nodeId: card._id, expectedVersion: args.expectedVersion, title: text(args.title, 'Card title', 100),
        body: text(args.body, 'Card text', 24_000, true), status: 'pending',
      }, card.textVersion);
  },
});

export const review = mutation({
  args: { ...scope, updateId: v.id('boardAgentUpdates'), apply: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await signedInEditor(ctx, args);
    const update = await ctx.db.get(args.updateId);
    if (update?.boardId !== args.boardId || !update.proposal) throw new BoardAgentError('Proposal unavailable.');
    const proposal = update.proposal;
    if (proposal.status !== 'pending') return { status: proposal.status };
    if (args.apply) {
      const card = await cardFor(ctx, args.boardId, update.nodeKey);
      if (card._id !== proposal.nodeId) throw new BoardAgentError('The original note is unavailable.');
      await requireCurrentNote(ctx, card, proposal.expectedVersion);
      await writeNote(ctx, card, proposal.title, proposal.body, userId);
    }
    const status = args.apply ? 'applied' : 'dismissed';
    await ctx.db.patch(update._id, { proposal: { ...proposal, status } });
    return { status };
  },
});

export const sources = query({
  args: scope,
  handler: async (ctx, args) => {
    await access(ctx, args.token, args.boardId);
    const rows = await ctx.db.query('boardAgentConnections')
      .withIndex('board', q => q.eq('boardId', args.boardId)).collect();
    return Promise.all(rows.filter(row => row.lastUpdateAt).map(async row => ({
      id: row._id, name: row.name, latest: row.lastUpdateAt, owner: await ownerName(ctx, row.userId),
    })));
  },
});

async function timeline(ctx: any, boardId: string, limit: number, connectionId?: string) {
  ctx.db.readCollections.add('boardAgentUpdates');
  const { rows } = await ctx.db.sql.query(
    `select id, created_at as timestamp, agent_name as author, title, result, node_key as "nodeKey", proposal
     from branch_private.board_agent_updates where board_id=$1 ${connectionId ? 'and connection_id=$3' : ''}
     order by created_at desc,id desc limit $2`,
    connectionId ? [boardId, limit + 1, connectionId] : [boardId, limit + 1],
  );
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

export const activity = query({
  args: { ...scope, connectionId: v.string(), limit: v.number() },
  handler: async (ctx, args) => {
    await access(ctx, args.token, args.boardId);
    return timeline(ctx, args.boardId, pageSize(args.limit, 200), args.connectionId);
  },
});

export const readContext = internalQuery({
  args: { ...key, limit: v.number() },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash);
    return timeline(ctx, connection.boardId, pageSize(args.limit, 30));
  },
});

// Planning tools: short structured cards on the canvas, full reasoning in Context.
const actorOf = (connection: any): Actor => ({
  boardId: connection.boardId, userId: connection.userId, agent: connection.name, connectionId: connection._id,
});
const planKey = (planId?: string) => {
  if (planId === undefined) return undefined;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(planId)) throw new BoardAgentError('Use a plan ID of letters, numbers, dashes or underscores.');
  return 'plan-' + planId;
};
// Retries of the same request resolve to the same card.
async function cardKey(connection: any, requestId: string) {
  const hex = await tokenHash(JSON.stringify([connection._id, operationId(requestId)]));
  return `agent-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
async function claimCard(ctx: any, connection: any, requestId: string, key: string, created: boolean) {
  if (!created) return;
  const card = await cardFor(ctx, connection.boardId, key);
  await ctx.db.insert('boardAgentCards', {
    boardId: connection.boardId, connectionId: connection._id, nodeId: card._id, requestId, fingerprint: 'plan-card',
  });
}
const planCard = {
  ...request, planId: v.optional(v.string()), title: v.string(), summary: v.string(), points: v.optional(v.array(v.string())),
  step: v.optional(v.union(v.string(), v.number())), detail: v.optional(v.string()), sources: v.optional(v.array(v.any())),
  replaces: v.optional(v.array(v.string())), files: v.optional(v.array(v.string())), related: v.optional(v.array(v.any())),
};

export const brief = internalMutation({
  args: { ...key, focus: v.optional(v.any()), full: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash);
    return { you: { agent: connection.name, mode: connection.mode }, ...(await deliverBrief(ctx, actorOf(connection), { focus: args.focus, full: args.full })) };
  },
});

export const updatePlan = internalMutation({
  args: {
    ...key, planId: v.optional(v.string()), title: v.optional(v.string()), goal: v.string(), steps: v.array(v.any()),
    expectedVersion: v.number(), summary: v.optional(v.string()), detail: v.optional(v.string()), moves: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash, true);
    return savePlan(ctx, actorOf(connection), {
      key: await resolvePlanKey(ctx, connection.boardId, args.planId), title: args.title, goal: args.goal, steps: args.steps,
      expectedVersion: args.expectedVersion, summary: args.summary, detail: args.detail, shared: true, goalLimit: 280, moves: args.moves,
    });
  },
});

export const addPlanCard = internalMutation({
  args: { ...planCard, kind: v.string() },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash, true);
    const id = await cardKey(connection, args.requestId);
    const result = await saveCard(ctx, actorOf(connection), { ...args, key: id, planKey: planKey(args.planId) });
    await claimCard(ctx, connection, args.requestId, id, result.created);
    return result;
  },
});

export const recordPlanDecision = internalMutation({
  args: { ...planCard, planChanges: v.optional(v.array(v.any())) },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash, true);
    const id = await cardKey(connection, args.requestId);
    const result = await recordDecision(ctx, actorOf(connection), { ...args, key: id, planKey: planKey(args.planId) });
    await claimCard(ctx, connection, args.requestId, id, result.created);
    return result;
  },
});

export const addPlanSource = internalMutation({
  args: {
    ...key, planId: v.optional(v.string()), url: v.optional(v.string()), file: v.optional(v.any()), cardId: v.optional(v.string()),
    title: v.optional(v.string()), note: v.optional(v.string()), forCard: v.optional(v.string()),
    step: v.optional(v.union(v.string(), v.number())),
  },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash, true);
    return saveSource(ctx, actorOf(connection), { ...args, planKey: planKey(args.planId) });
  },
});

// Account-authenticated agents read the same Context timeline as connected agents.
export const recent = query({
  args: { ...scope, limit: v.number() },
  handler: async (ctx, args) => {
    await access(ctx, args.token, args.boardId);
    return timeline(ctx, args.boardId, pageSize(args.limit, 30));
  },
});

export const revisePlanCard = internalMutation({
  args: {
    ...key, cardId: v.string(), title: v.optional(v.string()), summary: v.optional(v.string()), points: v.optional(v.array(v.string())),
    detail: v.optional(v.string()), sources: v.optional(v.array(v.any())), step: v.optional(v.union(v.string(), v.number())),
    expectedRevision: v.optional(v.number()), files: v.optional(v.array(v.string())), related: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash, true);
    return revisePlanCardText(ctx, actorOf(connection), { ...args, key: args.cardId });
  },
});

export const logPlanResearch = internalMutation({
  args: { ...key, title: v.string(), detail: v.string() },
  handler: async (ctx, args) => {
    const { connection } = await connectionFor(ctx, args.keyHash, true);
    return logResearch(ctx, actorOf(connection), args);
  },
});

// Everything agents have written about this board, for the structured Context view:
// each entry is attached to the card it explains, or to the plan when it has none.
export const contextMap = query({
  args: scope,
  handler: async (ctx, args) => {
    await access(ctx, args.token, args.boardId);
    return timeline(ctx, args.boardId, 500);
  },
});
