import { v } from 'convex/values';
import { query, type MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { access } from './access';
import { initialDocument } from './documents';
import { place } from '../app/auto-layout.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function appendUpdate(ctx: MutationCtx,
  { boardId, userId, boardTitle }: { boardId: Id<'boards'>; userId: Id<'users'>; boardTitle: string },
  args: { conversationId: string; updateId: string; title: string; result: string },
) {
  const title = args.title.trim();
  const result = args.result.trim();
  if (!/^[a-f0-9]{64}$/.test(args.conversationId) || !uuid.test(args.updateId) || !title || title.length > 120
    || !result || result.length > 12_000) {
    throw new Error('Use a short title and a result of up to 12,000 characters.');
  }
  const existing = await ctx.db.query('chatgptThreads').withIndex('conversation', q =>
    q.eq('boardId', boardId).eq('userId', userId).eq('conversationId', args.conversationId)).unique();
  const nodeKey = existing?.nodeKey || 'chatgpt-' + crypto.randomUUID();
  const now = Date.now();
  let threadId;
  let nodeId;
  if (existing) {
    const node = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', boardId).eq('key', nodeKey)).unique();
    if (!node || node.deleted) throw new Error('This card was deleted. Restore it in Branch, or start a new ChatGPT conversation.');
    threadId = existing._id;
    nodeId = node._id;
  } else {
    const nodes = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', boardId)).collect();
    const origin = { x: 140, y: 160 };
    const target = place(nodes.filter(node => !node.deleted).map(node => node.data), origin, 380, 175);
    const data = { id: nodeKey, type: 'plan', title, body: '', width: 380, ...target, revision: 1, titleEdited: true };
    nodeId = await ctx.db.insert('nodes', {
      boardId, key: nodeKey, data, textState: initialDocument(data), textVersion: 0,
      createdBy: userId, updatedBy: userId, deleted: false, chatgptSynced: true,
    });
    threadId = await ctx.db.insert('chatgptThreads', { boardId, userId, conversationId: args.conversationId, nodeKey });
  }
  const previous = await ctx.db.query('chatgptUpdates').withIndex('update', q => q.eq('threadId', threadId).eq('updateId', args.updateId)).unique();
  if (previous) {
    if (previous.result !== result) throw new Error('Use a new update ID for new content.');
  } else {
    await ctx.db.insert('chatgptUpdates', { threadId, updateId: args.updateId, result });
    await ctx.db.patch(nodeId, { chatgptLatestUpdate: now });
    await ctx.db.patch(boardId, { updatedAt: now });
  }
  return { boardTitle, cardId: nodeKey };
}

export const read = query({
  args: { boardId: v.id('boards'), nodeKey: v.string(), token: v.string(), limit: v.number() },
  handler: async (ctx, { boardId, nodeKey, token, limit }) => {
    await access(ctx, token, boardId);
    const node = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', boardId).eq('key', nodeKey)).unique();
    if (!node?.chatgptSynced || node.deleted) return { items: [], hasMore: false };
    const thread = await ctx.db.query('chatgptThreads').withIndex('card', q => q.eq('boardId', boardId).eq('nodeKey', nodeKey)).unique();
    if (!thread) return { items: [], hasMore: false };
    const size = Math.min(200, Math.max(10, Math.floor(limit)));
    const rows = (await ctx.db.query('chatgptUpdates').withIndex('thread', q => q.eq('threadId', thread._id)).order('desc').take(size + 1))
      .map(u => ({ id: u._id, timestamp: u._creationTime, result: u.result }));
    return { items: rows.slice(0, size), hasMore: size < 200 && rows.length > size };
  },
});
