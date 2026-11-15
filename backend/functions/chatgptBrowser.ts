import { v } from '../validation';
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from '../definitions';
import { access, accessForUser, currentUser, tokenHash } from './access';
import { appendUpdate } from './agentContext';

const digest = /^[a-f0-9]{64}$/;
const key = /^branch_chrome_[a-f0-9]{64}$/;
const unauthorized = () => new Error('chrome_sync_disconnected');

export const connect = mutation({
  args: { boardId: v.id('boards'), conversationId: v.string() },
  handler: async (ctx, { boardId, conversationId }) => {
    if (!digest.test(conversationId)) throw new Error('Invalid conversation.');
    const { userId, board } = await access(ctx, '', boardId, true);
    if ((await ctx.db.get(userId))?.kind !== 'account') throw unauthorized();
    const secret = 'branch_chrome_' + Array.from(crypto.getRandomValues(new Uint8Array(32)),
      byte => byte.toString(16).padStart(2, '0')).join('');
    const old = await ctx.db.query('chatgptBrowserGrants').withIndex('user_chat',
      q => q.eq('userId', userId).eq('conversationId', conversationId)).unique();
    const values = { userId, boardId, conversationId, keyHash: await tokenHash(secret) };
    if (old) await ctx.db.replace(old._id, values);
    else await ctx.db.insert('chatgptBrowserGrants', values);
    return { key: secret, boardId, boardTitle: board.title };
  },
});

async function grantForKey(ctx: QueryCtx, secret: string) {
  if (!key.test(secret)) throw unauthorized();
  const hash = await tokenHash(secret);
  return ctx.db.query('chatgptBrowserGrants').withIndex('key', q => q.eq('keyHash', hash)).unique();
}

async function destination(ctx: QueryCtx, key: string) {
  const grant = await grantForKey(ctx, key);
  if (!grant) throw unauthorized();
  try {
    const { board } = await accessForUser(ctx, grant.userId, grant.boardId, true);
    return { ...grant, boardTitle: board.title };
  } catch {
    throw unauthorized();
  }
}

export const status = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const { boardTitle } = await destination(ctx, key);
    return { boardTitle };
  },
});

export const save = internalMutation({
  args: { key: v.string(), updateId: v.string(), title: v.string(), result: v.string() },
  handler: async (ctx, { key, updateId, title, result }) => {
    const target = await destination(ctx, key);
    return appendUpdate(ctx, target, { updateId, title, result, conversationId: target.conversationId });
  },
});

export const stop = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const grant = await grantForKey(ctx, key);
    if (grant) await ctx.db.delete(grant._id);
  },
});

export const count = query({
  args: { boardId: v.id('boards') },
  handler: async (ctx, { boardId }) => {
    const userId = await currentUser(ctx);
    return (await ctx.db.query('chatgptBrowserGrants').withIndex('user_board',
      q => q.eq('userId', userId).eq('boardId', boardId)).collect()).length;
  },
});

export const disconnectBoard = mutation({
  args: { boardId: v.id('boards') },
  handler: async (ctx, { boardId }) => {
    const userId = await currentUser(ctx);
    const grants = await ctx.db.query('chatgptBrowserGrants').withIndex('user_board',
      q => q.eq('userId', userId).eq('boardId', boardId)).collect();
    for (const grant of grants) await ctx.db.delete(grant._id);
  },
});
