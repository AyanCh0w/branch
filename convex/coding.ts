import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { ConvexError, v } from 'convex/values';
import { access, accessForUser, tokenHash } from './access';
import { contextForChat, loadDocument, readText } from './documents';
import { textOf } from '../app/context.js';

const scope = { boardId: v.id('boards'), token: v.string() };
const cardScope = { ...scope, nodeKey: v.string() };
const handoffScope = { keyHash: v.string(), handoffId: v.id('codingHandoffs') };
const ttl = 60 * 60 * 1000;
const maxResult = 32_000;
const unavailable = () => new ConvexError('This handoff is unavailable. Check your Branch connection and card access, or create a new handoff.');

async function editor(ctx: QueryCtx, args: { token: string; boardId: Id<'boards'> }) {
  const { userId } = await access(ctx, args.token, args.boardId, true);
  if ((await ctx.db.get(userId))?.kind !== 'account') throw new ConvexError('Sign in to a Branch account to connect a coding agent.');
  return userId;
}

async function card(ctx: QueryCtx, boardId: Id<'boards'>, nodeKey: string) {
  const node = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', boardId).eq('key', nodeKey)).unique();
  if (!node || node.deleted || node.data.type === 'search') throw unavailable();
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

// Who wrote what, so the person handing off (and the agent) can tell their own
// words from collaborators', AI replies, and retrieved web or GitHub content.
async function names(ctx: QueryCtx, ids: Iterable<string>) {
  const out: string[] = [];
  for (const raw of new Set(ids)) {
    const id = ctx.db.normalizeId('users', raw);
    const user = id ? await ctx.db.get(id) : null;
    if (user) out.push((user.name || 'A collaborator').slice(0, 60));
  }
  return out.sort();
}
function originOf(data: any) {
  if (!data) return 'unknown';
  if (data.type === 'github') return 'github';
  if (data.type === 'web' || data.researchSource) return 'web';
  if (data.type === 'thread') return 'chat';
  if (data.type === 'media') return data.mediaType === 'video' ? 'video' : 'image';
  if (data.type === 'upload') return 'file';
  return 'note';
}

async function snapshot(ctx: QueryCtx, boardId: Id<'boards'>, nodeKey: string, viewer: Id<'users'>) {
  const node = await card(ctx, boardId, nodeKey);
  const doc = loadDocument(node.textState);
  const { title, body, draft } = readText(doc);
  doc.destroy();
  const current = { ...node.data, title, body, draft };
  const text = [textOf(current), draft.trim() ? 'Unsent prompt:\n' + draft : ''].filter(Boolean).join('\n\n');
  const resolved = contextForChat(node.data.contexts || []).filter(source => source.text || source.quote || source.attachment);
  const sources = [];
  for (const source of resolved.slice(0, 20)) {
    const origin = source.source ? await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', boardId).eq('key', String(source.source))).unique() : null;
    const writers = origin ? [String(origin.createdBy), String(origin.updatedBy)] : [];
    sources.push({
      title: excerpt(String(source.title || 'Source'), 200),
      text: excerpt(String(source.text || ''), 3_000),
      quote: excerpt(String(source.quote || ''), 1_000),
      fileOmitted: !!source.attachment,
      origin: originOf(origin?.data),
      authors: await names(ctx, writers),
      fromOthers: writers.some(id => id !== String(viewer)),
    });
  }
  const messages = Array.isArray(current.messages) ? current.messages : [];
  const cardWriters = [String(node.createdBy), String(node.updatedBy), ...messages.filter((m: any) => m.role === 'user' && m.sentBy).map((m: any) => String(m.sentBy))];
  const origins = new Set([originOf(current), ...sources.map(s => s.origin)]);
  const provenance = {
    authors: await names(ctx, cardWriters),
    fromOthers: cardWriters.some(id => id !== String(viewer)) || sources.some(s => s.fromOthers),
    includesAI: messages.some((m: any) => m.role === 'assistant' && String(m.text || '').trim()),
    includesWeb: origins.has('web') || messages.some((m: any) => m.role === 'assistant' && /\]\(https?:\/\//.test(String(m.text || ''))),
    includesGitHub: origins.has('github'),
  };
  const content = {
    title: excerpt(title || 'Untitled card', 200),
    text: excerpt(text, 32_000),
    fileOmitted: (current.type === 'upload' && !current.text) || (current.type === 'media' && current.mediaType !== 'video'),
    sources,
    omittedSources: resolved.length - sources.length,
    provenance,
  };
  return { node, content, fingerprint: await tokenHash(JSON.stringify({ nodeId: node._id, content })) };
}

export const status = query({
  args: scope,
  handler: async (ctx, args) => {
    const userId = await editor(ctx, args);
    const linked = await connection(ctx, args.boardId, userId);
    const rows = await ctx.db.query('codingHandoffs').withIndex('board_user', q => q.eq('boardId', args.boardId).eq('userId', userId)).collect();
    return { endpoint: new URL('/mcp', process.env.CONVEX_SITE_URL || 'http://127.0.0.1:3211').href, connected: !!linked, handoffs: rows.map(({ _id, nodeKey, expiresAt, result }) => ({
      id: _id, nodeKey, expiresAt, hasDraft: !!result,
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
    if (!/^[a-f0-9]{64}$/.test(keyHash)) throw new ConvexError('Create a new connection key.');
    const duplicate = await ctx.db.query('codingConnections').withIndex('key', q => q.eq('keyHash', keyHash)).unique();
    if (duplicate && duplicate._id !== existing?._id) throw new ConvexError('Create a new connection key.');
    if (existing) await ctx.db.patch(existing._id, { keyHash });
    else await ctx.db.insert('codingConnections', { boardId: args.boardId, userId, keyHash });
  },
});

export const preview = query({
  args: cardScope,
  handler: async (ctx, args) => {
    const userId = await editor(ctx, args);
    const { content, fingerprint } = await snapshot(ctx, args.boardId, args.nodeKey, userId);
    return { ...content, fingerprint };
  },
});

export const create = mutation({
  args: { ...cardScope, fingerprint: v.string(), sources: v.array(v.number()) },
  handler: async (ctx, args) => {
    const userId = await editor(ctx, args);
    if (!await connection(ctx, args.boardId, userId)) throw new ConvexError('Connect your coding agent first.');
    const { node, content, fingerprint } = await snapshot(ctx, args.boardId, args.nodeKey, userId);
    if (fingerprint !== args.fingerprint) throw new ConvexError('The card changed. Review the updated preview before sending.');
    const selected = new Set(args.sources);
    if (args.sources.length > content.sources.length || [...selected].some(i => !Number.isInteger(i) || !content.sources[i])) {
      throw new ConvexError('Select sources from this card.');
    }
    const previous = await latest(ctx, node._id, userId);
    if (previous && (previous.result || previous.expiresAt > Date.now())) {
      throw new ConvexError('Resolve the current handoff before creating another.');
    }
    const handoffs = await ctx.db.query('codingHandoffs').withIndex('board_user', q => q.eq('boardId', args.boardId).eq('userId', userId)).collect();
    const expired = handoffs.filter(row => !row.result && row.expiresAt <= Date.now());
    if (handoffs.length - expired.length >= 20) throw new ConvexError('Resolve an existing handoff before creating another.');
    for (const row of expired) await ctx.db.delete(row._id);
    const expiresAt = Date.now() + ttl;
    const { title, text, fileOmitted } = content;
    const id = await ctx.db.insert('codingHandoffs', {
      boardId: args.boardId, userId, nodeId: node._id, nodeKey: args.nodeKey, expiresAt,
      content: { title, text, fileOmitted, provenance: content.provenance, sources: content.sources.filter((_, i) => selected.has(i)) },
    });
    return { id, expiresAt };
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

export const resolve = mutation({
  args: { ...cardScope, handoffId: v.id('codingHandoffs'), publish: v.boolean(), expectedPublishedId: v.optional(v.id('codingHandoffs')) },
  handler: async (ctx, args) => {
    const userId = await editor(ctx, args);
    const node = await card(ctx, args.boardId, args.nodeKey);
    const row = await latest(ctx, node._id, userId);
    if (!row || row._id !== args.handoffId) throw unavailable();
    if (args.publish) {
      if (!row.result) throw new ConvexError('There is no draft to publish.');
      if (node.codingResult?.handoffId !== args.expectedPublishedId) throw new ConvexError('The shared result changed. Review it before publishing.');
      await ctx.db.patch(node._id, { codingResult: { handoffId: row._id, text: row.result } });
      await ctx.db.patch(args.boardId, { updatedAt: Date.now() });
    }
    await ctx.db.delete(row._id);
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
  args: { keyHash: v.string() },
  handler: async (ctx, { keyHash }) => { await authorizedConnection(ctx, keyHash); },
});

async function authorize(ctx: QueryCtx, { keyHash, handoffId }: { keyHash: string; handoffId: Id<'codingHandoffs'> }) {
  const linked = await authorizedConnection(ctx, keyHash);
  const row = await ctx.db.get(handoffId);
  if (!row || linked.userId !== row.userId || linked.boardId !== row.boardId || row.expiresAt <= Date.now()
    || (await ctx.db.get(row.nodeId))?.deleted !== false) throw unavailable();
  return row;
}

export const readHandoff = internalQuery({
  args: handoffScope,
  handler: async (ctx, args) => (await authorize(ctx, args)).content,
});

export const returnDraft = internalMutation({
  args: { ...handoffScope, text: v.string() },
  handler: async (ctx, args) => {
    const row = await authorize(ctx, args);
    const text = args.text.trim();
    if (!text || text.length > maxResult) throw new ConvexError('Return between 1 and 32,000 characters.');
    if (row.result === text) return;
    if (row.result) throw new ConvexError('A draft is already saved. Review it in Branch.');
    await ctx.db.patch(row._id, { result: text });
  },
});
