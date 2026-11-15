import { v } from '../validation';
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from '../definitions';
import { access, accessForUser, currentUser, tokenHash } from './access';
import { appendUpdate } from './agentContext';

const digest = /^[a-f0-9]{64}$/;
const key = /^branch_chrome_[a-f0-9]{64}$/;
const desktopKey = /^branch_desktop_([0-9]{13})_[a-f0-9]{64}$/;
const desktopLifetime = 8 * 60 * 60 * 1000;
const unauthorized = () => new Error('chrome_sync_disconnected');
const source = v.optional(v.literal('desktop'));

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

export const connectDesktop = mutation({
  args: { boardId: v.id('boards'), conversationId: v.string(), keyHash: v.string() },
  handler: async (ctx, args) => {
    if (!digest.test(args.conversationId) || !digest.test(args.keyHash)) throw new Error('Invalid desktop pairing.');
    const { userId } = await access(ctx, '', args.boardId, true);
    if ((await ctx.db.get(userId))?.kind !== 'account') throw unauthorized();
    const conversationId = await tokenHash('desktop:' + args.conversationId);
    const duplicate = await ctx.db.query('chatgptBrowserGrants').withIndex('key', q => q.eq('keyHash', args.keyHash)).unique();
    const old = await ctx.db.query('chatgptBrowserGrants').withIndex('user_chat',
      q => q.eq('userId', userId).eq('conversationId', conversationId)).unique();
    if (duplicate && (duplicate._id !== old?._id || duplicate.boardId !== args.boardId)) {
      throw new Error('This pairing was already used. Start again in the Mac app.');
    }
    const values = { userId, boardId: args.boardId, conversationId, keyHash: args.keyHash };
    if (old) await ctx.db.replace(old._id, values);
    else await ctx.db.insert('chatgptBrowserGrants', values);
  },
});

async function grantForKey(ctx: QueryCtx, secret: string, transport?: 'desktop') {
  if (transport === 'desktop') {
    const match = desktopKey.exec(secret);
    const now = Date.now();
    if (!match || Number(match[1]) <= now || Number(match[1]) > now + desktopLifetime) throw unauthorized();
  } else if (!key.test(secret)) throw unauthorized();
  const hash = await tokenHash(secret);
  return ctx.db.query('chatgptBrowserGrants').withIndex('key', q => q.eq('keyHash', hash)).unique();
}

async function destination(ctx: QueryCtx, key: string, transport?: 'desktop') {
  const grant = await grantForKey(ctx, key, transport);
  if (!grant) throw unauthorized();
  try {
    const { board } = await accessForUser(ctx, grant.userId, grant.boardId, true);
    return { ...grant, boardTitle: board.title };
  } catch {
    throw unauthorized();
  }
}

export const status = internalQuery({
  args: { key: v.string(), source },
  handler: async (ctx, { key, source }) => {
    const { boardTitle, boardId } = await destination(ctx, key, source);
    return source === 'desktop' ? { boardTitle, boardId } : { boardTitle };
  },
});

export const save = internalMutation({
  args: { key: v.string(), updateId: v.string(), title: v.string(), result: v.string(), source },
  handler: async (ctx, { key, updateId, title, result, source }) => {
    const target = await destination(ctx, key, source);
    return appendUpdate(ctx, target, { updateId, title, result, conversationId: target.conversationId });
  },
});

export const stop = internalMutation({
  args: { key: v.string(), source },
  handler: async (ctx, { key, source }) => {
    const grant = await grantForKey(ctx, key, source);
    if (grant) await ctx.db.delete(grant._id);
    if (source === 'desktop') return {};
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
