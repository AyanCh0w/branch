// Keeps agent connections in step with board access, and removes expired rows.
import { internalMutation, type MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { accessForUser } from './access';
import { grantMaxMs } from './chatgptOAuth';

const BATCH = 500;

async function stillEditor(ctx: MutationCtx, userId: Id<'users'>, boardId: Id<'boards'>) {
  try { await accessForUser(ctx, userId, boardId, true); return (await ctx.db.get(userId))?.kind === 'account'; } catch { return false; }
}

// Coding-agent keys and ChatGPT grants only work while their person can edit the
// board. Deleting them when access ends means re-adding someone later doesn't
// silently revive an old key or refresh token.
async function prune(ctx: MutationCtx, rows: { _id: any; userId: Id<'users'>; boardId: Id<'boards'> }[]) {
  let removed = 0;
  for (const row of rows) if (!await stillEditor(ctx, row.userId, row.boardId)) { await ctx.db.delete(row._id); removed++; }
  return removed;
}

export async function pruneBoardAgents(ctx: MutationCtx, boardId: Id<'boards'>) {
  const coding = await ctx.db.query('codingConnections').withIndex('board_user', q => q.eq('boardId', boardId)).collect();
  const grants = (await ctx.db.query('chatgptGrants').collect()).filter(g => g.boardId === boardId);
  return prune(ctx, [...coding, ...grants]);
}

export async function pruneUserAgents(ctx: MutationCtx, userId: Id<'users'>) {
  const coding = (await ctx.db.query('codingConnections').collect()).filter(c => c.userId === userId);
  const grants = await ctx.db.query('chatgptGrants').withIndex('user', q => q.eq('userId', userId)).collect();
  return prune(ctx, [...coding, ...grants]);
}

export const cleanup = internalMutation({
  args: {},
  handler: async ctx => {
    const now = Date.now();
    let removed = 0;
    for (const code of await ctx.db.query('chatgptCodes').take(BATCH)) if (code.expiresAt <= now) { await ctx.db.delete(code._id); removed++; }
    // Unanswered handoffs past expiry; drafts waiting for review are kept.
    for (const row of await ctx.db.query('codingHandoffs').take(BATCH)) if (!row.result && row.expiresAt <= now) { await ctx.db.delete(row._id); removed++; }
    for (const grant of await ctx.db.query('chatgptGrants').take(BATCH)) {
      if (grant.refreshUntil <= now || (grant.grantedAt ?? grant._creationTime) + grantMaxMs <= now) { await ctx.db.delete(grant._id); removed++; }
    }
    removed += await prune(ctx, [...await ctx.db.query('codingConnections').take(BATCH), ...await ctx.db.query('chatgptGrants').take(BATCH)]);
    return removed;
  },
});
