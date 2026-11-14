import { ConvexError, v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { internalMutation, query } from './_generated/server';
import { access } from './access';
import { initialDocument } from './documents';
import { place } from '../app/auto-layout.js';
import { frontend, syncGrant } from './chatgptOAuth';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

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
    const nodeKey = existing?.nodeKey || crypto.randomUUID();
    const now = Date.now();
    let threadId;
    let nodeId;
    if (existing) {
      const node = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', boardId).eq('key', nodeKey)).unique();
      if (!node || node.deleted) throw new ConvexError('This card was deleted. Restore it in Branch, or start a new ChatGPT conversation.');
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
      if (previous.prompt !== prompt || previous.result !== result) throw new ConvexError('Use a new update ID for new content.');
    } else {
      await ctx.db.insert('chatgptUpdates', { threadId, updateId: args.updateId, prompt, result });
      await ctx.db.patch(nodeId, { chatgptLatestUpdate: now });
      await ctx.db.patch(boardId, { updatedAt: now });
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
