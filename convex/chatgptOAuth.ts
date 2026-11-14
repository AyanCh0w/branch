import { v, ConvexError } from 'convex/values';
import { mutation, query, internalMutation, internalQuery, type QueryCtx } from './_generated/server';
import { access, accessForUser, currentUser, tokenHash } from './access';

export const syncScope = 'branch:sync';
export const chatgptClient = 'https://chatgpt.com/oauth/client.json';
export const chatgptRedirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
export const issuer = () => (process.env.BRANCH_CONNECTOR_URL || process.env.CONVEX_SITE_URL || '').replace(/\/$/, '');
export const resource = () => issuer() + '/chatgpt/mcp';
export const frontend = () => (process.env.BRANCH_APP_URL || 'http://127.0.0.1:4387').replace(/\/$/, '');
export const accessSeconds = 3600;
const refreshMs = 30 * 86400_000;
const digest = /^[a-f0-9]{64}$/;
const challenge = /^[A-Za-z0-9_-]{43}$/;

export const authorizeFields = {
  clientId: v.string(), redirectUri: v.string(), resource: v.string(), challenge: v.string(), state: v.string(),
};

export function validRequest(args: { clientId: string; redirectUri: string; resource: string; challenge: string; state: string }) {
  return args.clientId === chatgptClient && args.redirectUri === chatgptRedirect
    && args.resource === resource() && challenge.test(args.challenge) && /^[\x21-\x7e]{1,1024}$/.test(args.state);
}

export const authorize = mutation({
  args: { ...authorizeFields, boardId: v.id('boards'), codeHash: v.string() },
  handler: async (ctx, args) => {
    if (!validRequest(args) || !digest.test(args.codeHash)) throw new ConvexError('Invalid ChatGPT connection request.');
    const { userId } = await access(ctx, '', args.boardId, true);
    if ((await ctx.db.get(userId))?.kind !== 'account') throw new ConvexError('Sign in to Branch.');
    const old = await ctx.db.query('chatgptCodes').withIndex('user_board', q => q.eq('userId', userId).eq('boardId', args.boardId)).collect();
    for (const code of old) await ctx.db.delete(code._id);
    await ctx.db.insert('chatgptCodes', {
      userId, boardId: args.boardId, codeHash: args.codeHash, challenge: args.challenge,
      resource: args.resource, expiresAt: Date.now() + 5 * 60_000,
    });
    return { redirect: chatgptRedirect, issuer: issuer() };
  },
});

const invalidGrant = () => new ConvexError('invalid_grant');
export const exchange = internalMutation({
  args: {
    resource: v.string(), accessHash: v.string(), refreshHash: v.string(),
    code: v.optional(v.object({ hash: v.string(), challenge: v.string() })),
    refresh: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.resource !== resource() || !digest.test(args.accessHash) || !digest.test(args.refreshHash)) throw invalidGrant();
    const now = Date.now();
    const tokenFields = {
      resource: args.resource, accessHash: args.accessHash, refreshHash: args.refreshHash,
      accessUntil: now + accessSeconds * 1000, refreshUntil: now + refreshMs,
    };
    if (args.code) {
      const code = args.code;
      const saved = await ctx.db.query('chatgptCodes').withIndex('code', q => q.eq('codeHash', code.hash)).unique();
      if (!saved || saved.expiresAt <= now || saved.challenge !== code.challenge || saved.resource !== args.resource) throw invalidGrant();
      await accessForUser(ctx, saved.userId, saved.boardId, true);
      const old = await ctx.db.query('chatgptGrants').withIndex('user_board', q => q.eq('userId', saved.userId).eq('boardId', saved.boardId)).unique();
      if (old) await ctx.db.patch(old._id, tokenFields);
      else await ctx.db.insert('chatgptGrants', { ...tokenFields, userId: saved.userId, boardId: saved.boardId });
      await ctx.db.delete(saved._id);
    } else if (args.refresh) {
      const refresh = args.refresh;
      const old = await ctx.db.query('chatgptGrants').withIndex('refresh', q => q.eq('refreshHash', refresh)).unique();
      if (!old || old.refreshUntil <= now || old.resource !== args.resource) throw invalidGrant();
      await accessForUser(ctx, old.userId, old.boardId, true);
      await ctx.db.patch(old._id, tokenFields);
    } else throw invalidGrant();
  },
});

export async function syncGrant(ctx: QueryCtx, accessHash: string) {
  const grant = await ctx.db.query('chatgptGrants').withIndex('access', q => q.eq('accessHash', accessHash)).unique();
  if (!grant || grant.accessUntil <= Date.now() || grant.resource !== resource()) throw invalidGrant();
  try {
    const { board } = await accessForUser(ctx, grant.userId, grant.boardId, true);
    const profile = await ctx.db.get(grant.userId);
    if (profile?.kind !== 'account') throw invalidGrant();
    return { ...grant, boardTitle: board.title, name: profile.name };
  } catch {
    throw invalidGrant();
  }
}

export const profile = internalQuery({
  args: { accessHash: v.string() },
  handler: async (ctx, { accessHash }) => {
    const grant = await syncGrant(ctx, accessHash);
    return { id: String(grant.userId), ...(grant.name ? { name: grant.name } : {}) };
  },
});

export const connection = query({
  args: { boardId: v.id('boards') },
  handler: async (ctx, { boardId }) => {
    const userId = await currentUser(ctx);
    const grant = await ctx.db.query('chatgptGrants').withIndex('user_board', q => q.eq('userId', userId).eq('boardId', boardId)).unique();
    return { connected: !!grant && grant.refreshUntil > Date.now(), endpoint: resource() };
  },
});

export const disconnect = mutation({
  args: { boardId: v.id('boards') },
  handler: async (ctx, { boardId }) => {
    const userId = await currentUser(ctx);
    const grant = await ctx.db.query('chatgptGrants').withIndex('user_board', q => q.eq('userId', userId).eq('boardId', boardId)).unique();
    if (grant) await ctx.db.delete(grant._id);
    const codes = await ctx.db.query('chatgptCodes').withIndex('user_board', q => q.eq('userId', userId).eq('boardId', boardId)).collect();
    for (const code of codes) await ctx.db.delete(code._id);
  },
});

export async function pkce(verifier: string) {
  const hex = await tokenHash(verifier);
  const bytes = hex.match(/../g)!.map(byte => parseInt(byte, 16));
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
