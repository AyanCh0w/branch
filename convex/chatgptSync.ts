import { ConvexError, v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { internalMutation, query, type MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { access, touchBoard } from './access';
import { initialDocument } from './documents';
import { place } from '../app/auto-layout.js';
import { frontend, syncGrant } from './chatgptOAuth';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Keep the newest updates per conversation, and limit bursts.
export const MAX_UPDATES = 500;
export const BURST = 20;
const BURST_MS = 60_000;

async function newCard(ctx: MutationCtx, boardId: Id<'boards'>, userId: Id<'users'>, title: string) {
  const nodeKey = crypto.randomUUID();
  const nodes = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', boardId)).collect();
  const target = place(nodes.filter(node => !node.deleted).map(node => node.data), { x: 140, y: 160 }, 380, 175);
  const data = { id: nodeKey, type: 'plan', title, body: '', width: 380, ...target, revision: 1, titleEdited: true };
  const nodeId = await ctx.db.insert('nodes', {
    boardId, key: nodeKey, data, textState: initialDocument(data), textVersion: 0,
    createdBy: userId, updatedBy: userId, deleted: false, chatgptSynced: true,
  });
  return { nodeKey, nodeId };
}

export const append = internalMutation({
  args: {
    accessHash: v.string(), conversationId: v.string(), updateId: v.string(), title: v.string(),
    prompt: v.optional(v.string()), result: v.string(),
  },
  handler: async (ctx, args) => {
    const { boardId, userId, boardTitle } = await syncGrant(ctx, args.accessHash);
    const title = args.title.trim();
    const result = args.result.trim();
    const prompt = args.prompt?.trim() || undefined;
    if (!/^[a-f0-9]{64}$/.test(args.conversationId) || !uuid.test(args.updateId) || !title || title.length > 120
      || !result || result.length > 12_000 || (prompt?.length || 0) > 4000) {
      throw new ConvexError('Use a short title and a result of up to 12,000 characters.');
    }
    const existing = await ctx.db.query('chatgptThreads').withIndex('conversation', q =>
      q.eq('boardId', boardId).eq('userId', userId).eq('conversationId', args.conversationId)).unique();
    let nodeKey = existing?.nodeKey || '';
    const now = Date.now();
    let threadId;
    let nodeId;
    if (existing) {
      const node = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', boardId).eq('key', nodeKey)).unique();
      // A card deleted with undo available can still be restored; anything else gets a fresh card.
      if (node?.deleted && node.deletion) throw new ConvexError('This card was deleted. Restore it in Branch (undo), or start a new ChatGPT conversation.');
      threadId = existing._id;
      if (!node || node.deleted) {
        ({ nodeKey, nodeId } = await newCard(ctx, boardId, userId, title));
        await ctx.db.patch(existing._id, { nodeKey });
      } else nodeId = node._id;
    } else {
      ({ nodeKey, nodeId } = await newCard(ctx, boardId, userId, title));
      threadId = await ctx.db.insert('chatgptThreads', { boardId, userId, conversationId: args.conversationId, nodeKey });
    }
    const previous = await ctx.db.query('chatgptUpdates').withIndex('update', q => q.eq('threadId', threadId).eq('updateId', args.updateId)).unique();
    if (previous) {
      if (previous.prompt !== prompt || previous.result !== result) throw new ConvexError('Use a new update ID for new content.');
    } else {
      const recent = await ctx.db.query('chatgptUpdates').withIndex('thread', q => q.eq('threadId', threadId)).order('desc').take(BURST);
      if (recent.length >= BURST && recent[BURST - 1]._creationTime > now - BURST_MS) throw new ConvexError('Too many updates at once. Wait a minute, then sync again.');
      await ctx.db.insert('chatgptUpdates', { threadId, updateId: args.updateId, prompt, result });
      const oldest = await ctx.db.query('chatgptUpdates').withIndex('thread', q => q.eq('threadId', threadId)).order('desc').take(MAX_UPDATES + 5);
      for (const row of oldest.slice(MAX_UPDATES)) await ctx.db.delete(row._id);
      await ctx.db.patch(nodeId, { chatgptLatestUpdate: now });
      await touchBoard(ctx, boardId);
    }
    const url = new URL('/app', frontend());
    url.searchParams.set('board', boardId);
    url.searchParams.set('context', nodeKey);
    return { boardTitle, cardId: nodeKey, url: url.href };
  },
});

export const read = query({
  args: { boardId: v.id('boards'), nodeKey: v.string(), token: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await access(ctx, args.token, args.boardId);
    const node = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', args.boardId).eq('key', args.nodeKey)).unique();
    if (!node?.chatgptSynced || node.deleted) throw new ConvexError('Shared context is unavailable for this card.');
    const thread = await ctx.db.query('chatgptThreads').withIndex('card', q => q.eq('boardId', args.boardId).eq('nodeKey', args.nodeKey)).unique();
    if (!thread) throw new ConvexError('Shared context is unavailable for this card.');
    const page = await ctx.db.query('chatgptUpdates').withIndex('thread', q => q.eq('threadId', thread._id)).order('desc')
      .paginate({ ...args.paginationOpts, numItems: Math.min(10, args.paginationOpts.numItems) });
    return { ...page, page: page.page.map(({ _id, _creationTime, prompt, result }) => ({ id: _id, timestamp: _creationTime, prompt, result })) };
  },
});
