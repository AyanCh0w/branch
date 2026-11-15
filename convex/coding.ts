import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { access, accessForUser, tokenHash } from './access';
import { contextForChat, initialDocument, loadDocument, readText } from './documents';
import { textOf } from '../app/context.js';
import { place } from '../app/auto-layout.js';

const scope = { boardId: v.id('boards'), token: v.string() };
const cardScope = { ...scope, nodeKey: v.string() };
const credential = { keyHash: v.string(), oneTime: v.optional(v.boolean()) };
const handoffScope = { ...credential, handoffId: v.id('codingHandoffs') };
const ttl = 60 * 60 * 1000;
const maxResult = 32_000;
const unavailable = () => new Error('This handoff is unavailable. Check your Branch connection and card access, or create a new handoff.');

async function editor(ctx: QueryCtx, args: { token: string; boardId: Id<'boards'> }) {
  const { userId } = await access(ctx, args.token, args.boardId, true);
  if ((await ctx.db.get(userId))?.kind !== 'account') throw new Error('Sign in to a Branch account to connect a coding agent.');
  return userId;
}

async function card(ctx: QueryCtx, boardId: Id<'boards'>, nodeKey: string) {
  const node = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', boardId).eq('key', nodeKey)).unique();
  if (!node || node.deleted || node.chatgptSynced || node.data.type === 'search') throw unavailable();
  return node;
}

function connection(ctx: QueryCtx, boardId: Id<'boards'>, userId: Id<'users'>) {
  return ctx.db.query('codingConnections').withIndex('board_user', q => q.eq('boardId', boardId).eq('userId', userId)).unique();
}

function latest(ctx: QueryCtx, nodeId: Id<'nodes'>, userId: Id<'users'>) {
  return ctx.db.query('codingHandoffs').withIndex('node_user', q => q.eq('nodeId', nodeId).eq('userId', userId)).unique();
}

function excerpt(text: string, max: number) {
  return text.length <= max ? text : text.slice(0, max) + '\n[Remaining text omitted]';
}

async function snapshot(ctx: QueryCtx, boardId: Id<'boards'>, nodeKey: string) {
  const node = await card(ctx, boardId, nodeKey);
  const doc = loadDocument(node.textState);
  const { title, body, draft } = readText(doc);
  doc.destroy();
  const current = { ...node.data, title, body, draft };
  const text = [textOf(current), draft.trim() ? 'Unsent prompt:\n' + draft : ''].filter(Boolean).join('\n\n');
  const resolved = contextForChat(node.data.contexts || []).filter(source => source.text || source.quote || source.attachment);
  const sources = resolved.slice(0, 20).map(source => ({
    title: excerpt(String(source.title || 'Source'), 200),
    text: excerpt(String(source.text || ''), 3_000),
    quote: excerpt(String(source.quote || ''), 1_000),
    fileOmitted: !!source.attachment,
  }));
  const content = {
    title: excerpt(title || 'Untitled card', 200),
    text: excerpt(text, 32_000),
    fileOmitted: (current.type === 'upload' && !current.text) || (current.type === 'media' && current.mediaType !== 'video'),
    sources,
    omittedSources: resolved.length - sources.length,
  };
  return { node, content, fingerprint: await tokenHash(JSON.stringify({ nodeId: node._id, content })) };
}

export const status = query({
  args: scope,
  handler: async (ctx, args) => {
    const userId = await editor(ctx, args);
    const linked = await connection(ctx, args.boardId, userId);
    const rows = await ctx.db.query('codingHandoffs').withIndex('board_user', q => q.eq('boardId', args.boardId).eq('userId', userId)).collect();
    return { connected: !!linked, handoffs: rows.map(({ _id, nodeKey, expiresAt, result, oneTime, approvalHash }) => ({
      id: _id, nodeKey, expiresAt, hasDraft: !!result, oneTime: !!oneTime, approved: !!approvalHash,
    })) };
  },
});

export const configure = mutation({
  args: { ...scope, keyHash: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await editor(ctx, args);
    const existing = await connection(ctx, args.boardId, userId);
    if (!args.keyHash) {
      if (existing) await ctx.db.delete(existing._id);
      return;
    }
    const keyHash = args.keyHash;
    if (!/^[a-f0-9]{64}$/.test(keyHash)) throw new Error('Create a new connection key.');
    const duplicate = await ctx.db.query('codingConnections').withIndex('key', q => q.eq('keyHash', keyHash)).unique();
    if (duplicate && duplicate._id !== existing?._id) throw new Error('Create a new connection key.');
    if (existing) await ctx.db.patch(existing._id, { keyHash });
    else await ctx.db.insert('codingConnections', { boardId: args.boardId, userId, keyHash });
  },
});

export const preview = query({
  args: cardScope,
  handler: async (ctx, args) => {
    await editor(ctx, args);
    const { content, fingerprint } = await snapshot(ctx, args.boardId, args.nodeKey);
    return { ...content, fingerprint };
  },
});

export const create = mutation({
  args: { ...cardScope, fingerprint: v.string(), sources: v.array(v.number()), oneTime: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = await editor(ctx, args);
    if (!args.oneTime && !await connection(ctx, args.boardId, userId)) throw new Error('Connect your coding agent first.');
    const { node, content, fingerprint } = await snapshot(ctx, args.boardId, args.nodeKey);
    if (fingerprint !== args.fingerprint) throw new Error('The card changed. Review the updated preview before sending.');
    const selected = new Set<number>(args.sources);
    if (args.sources.length > content.sources.length || [...selected].some(i => !Number.isInteger(i) || !content.sources[i])) {
      throw new Error('Select sources from this card.');
    }
    const previous = await latest(ctx, node._id, userId);
    if (previous && (previous.result || previous.expiresAt > Date.now())) {
      throw new Error('Resolve the current handoff before creating another.');
    }
    const handoffs = await ctx.db.query('codingHandoffs').withIndex('board_user', q => q.eq('boardId', args.boardId).eq('userId', userId)).collect();
    const expired = handoffs.filter(row => !row.result && row.expiresAt <= Date.now());
    if (handoffs.length - expired.length >= 20) throw new Error('Resolve an existing handoff before creating another.');
    for (const row of expired) await ctx.db.delete(row._id);
    const expiresAt = Date.now() + ttl;
    const { title, text, fileOmitted } = content;
    const id = await ctx.db.insert('codingHandoffs', {
      boardId: args.boardId, userId, nodeId: node._id, nodeKey: args.nodeKey, expiresAt, oneTime: args.oneTime,
      content: { title, text, fileOmitted, sources: content.sources.filter((_: unknown, i: number) => selected.has(i)) },
    });
    return { id, expiresAt };
  },
});

export const approve = mutation({
  args: { ...cardScope, handoffId: v.id('codingHandoffs'), approvalHash: v.string() },
  handler: async (ctx, args) => {
    const userId = await editor(ctx, args);
    const node = await card(ctx, args.boardId, args.nodeKey);
    const row = await latest(ctx, node._id, userId);
    if (!row?.oneTime || row._id !== args.handoffId || row.expiresAt <= Date.now() || row.result) throw unavailable();
    if (!/^[a-f0-9]{64}$/.test(args.approvalHash)) throw new Error('Paste the full approval code from your coding chat.');
    if (row.approvalHash === args.approvalHash) return;
    if (row.approvalHash) throw new Error('This handoff is already approved. Revoke it to start over.');
    const existing = await ctx.db.query('codingHandoffs').withIndex('approval', q => q.eq('approvalHash', args.approvalHash)).unique();
    if (existing) throw new Error('Ask your coding chat for a new approval code.');
    await ctx.db.patch(row._id, { approvalHash: args.approvalHash });
  },
});

export const draft = query({
  args: cardScope,
  handler: async (ctx, args) => {
    const userId = await editor(ctx, args);
    const node = await card(ctx, args.boardId, args.nodeKey);
    const row = await latest(ctx, node._id, userId);
    return row?.result ? { id: row._id, text: row.result } : null;
  },
});

async function createResultNote(ctx: MutationCtx, source: Doc<'nodes'>, userId: Id<'users'>, handoffId: Id<'codingHandoffs'>, text: string) {
  const key = 'coding-' + handoffId;
  const existing = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', source.boardId).eq('key', key)).unique();
  if (existing) {
    if (existing.codingNote?.handoffId === handoffId && existing.codingNote.sourceKey === source.key) return key;
    throw new Error('Could not create the result note. Try a new handoff.');
  }

  const nodes = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', source.boardId)).collect();
  const width = 640;
  const minHeight = 360;
  const origin = { x: (source.data.x || 0) + (source.data.width || 520) + 64, y: source.data.y || 0 };
  const position = place(nodes.filter(node => !node.deleted).map(node => node.data), origin, width, minHeight);
  const heading = /^ {0,3}#{1,6}[ \t]+([^\n]+)/.exec(text)?.[1].trim();
  const title = (heading || 'Coding agent result').slice(0, 120);
  const data = { id: key, type: 'plan', title, body: text, width, minHeight, ...position, revision: 1, titleEdited: true };
  await ctx.db.insert('nodes', {
    boardId: source.boardId, key, data, textState: initialDocument(data), textVersion: 0,
    createdBy: userId, updatedBy: userId, deleted: false, codingNote: { sourceKey: source.key, handoffId },
  });
  return key;
}

export const resolve = mutation({
  args: { ...cardScope, handoffId: v.id('codingHandoffs'), publish: v.boolean(), expectedPublishedId: v.optional(v.id('codingHandoffs')) },
  handler: async (ctx, args) => {
    const userId = await editor(ctx, args);
    const node = await card(ctx, args.boardId, args.nodeKey);
    const row = await latest(ctx, node._id, userId);
    if (!row || row._id !== args.handoffId) throw unavailable();
    let noteKey: string | undefined;
    if (args.publish) {
      if (!row.result) throw new Error('There is no draft to publish.');
      if (node.codingResult?.handoffId !== args.expectedPublishedId) throw new Error('The shared result changed. Review it before publishing.');
      noteKey = await createResultNote(ctx, node, userId, row._id, row.result);
      await ctx.db.patch(node._id, { codingResult: { handoffId: row._id, noteKey } });
      await ctx.db.patch(args.boardId, { updatedAt: Date.now() });
    }
    await ctx.db.delete(row._id);
    return noteKey ?? null;
  },
});

export async function revokeCardHandoffs(ctx: MutationCtx, nodeId: Id<'nodes'>) {
  const rows = await ctx.db.query('codingHandoffs').withIndex('node_user', q => q.eq('nodeId', nodeId)).collect();
  for (const row of rows) await ctx.db.delete(row._id);
}

async function authorizedConnection(ctx: QueryCtx, keyHash: string) {
  const linked = await ctx.db.query('codingConnections').withIndex('key', q => q.eq('keyHash', keyHash)).unique();
  if (!linked) throw unavailable();
  try {
    await accessForUser(ctx, linked.userId, linked.boardId, true);
    if ((await ctx.db.get(linked.userId))?.kind !== 'account') throw unavailable();
  } catch {
    throw unavailable();
  }
  return linked;
}

export const checkConnection = internalQuery({
  args: credential,
  handler: async (ctx, { keyHash, oneTime }) => {
    if (!oneTime) {
      await authorizedConnection(ctx, keyHash);
      return;
    }
    const row = await ctx.db.query('codingHandoffs').withIndex('approval', q => q.eq('approvalHash', keyHash)).unique();
    if (!row?.oneTime) throw unavailable();
    await authorize(ctx, { keyHash, oneTime, handoffId: row._id });
  },
});

async function authorize(ctx: QueryCtx, { keyHash, handoffId, oneTime }: { keyHash: string; handoffId: Id<'codingHandoffs'>; oneTime?: boolean }) {
  const row = await ctx.db.get(handoffId);
  if (!row || !!row.oneTime !== !!oneTime || row.expiresAt <= Date.now()
    || (await ctx.db.get(row.nodeId))?.deleted !== false) throw unavailable();
  if (oneTime) {
    if (row.approvalHash !== keyHash) throw unavailable();
    await accessForUser(ctx, row.userId, row.boardId, true);
  } else {
    const linked = await authorizedConnection(ctx, keyHash);
    if (linked.userId !== row.userId || linked.boardId !== row.boardId) throw unavailable();
  }
  return row;
}

export const readHandoff = internalQuery({
  args: handoffScope,
  handler: async (ctx, args) => {
    const row = await authorize(ctx, args);
    if (row.oneTime && row.result) throw unavailable();
    return row.content;
  },
});

export const returnDraft = internalMutation({
  args: { ...handoffScope, text: v.string() },
  handler: async (ctx, args) => {
    const row = await authorize(ctx, args);
    const text = args.text.trim();
    if (!text || text.length > maxResult) throw new Error('Return between 1 and 32,000 characters.');
    if (row.result === text) return;
    if (row.result) throw new Error('A draft is already saved. Review it in Branch.');
    await ctx.db.patch(row._id, { result: text });
  },
});
