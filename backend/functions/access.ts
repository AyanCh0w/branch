import type { QueryCtx, MutationCtx } from '../definitions';
import type { Id } from '../types';
import { getAuthUserId } from '../identity';

export async function tokenHash(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export function requireDevelopmentSecret(secret: string) {
  if (!process.env.DEV_BRIDGE_SECRET || secret !== process.env.DEV_BRIDGE_SECRET) throw Error('Unauthorized development bridge');
}
export async function currentUser(ctx: QueryCtx | MutationCtx, token='') {
  const accountId=await getAuthUserId(ctx);
  if(accountId)return accountId;
  if(!token)throw Error('Sign in to continue');
  const hash=await tokenHash(token);
  const session=await ctx.db.query('sessions').withIndex('token',q=>q.eq('tokenHash',hash)).unique();
  if(!session||session.expiresAt<=Date.now())throw Error('Session expired');
  const user=await ctx.db.get(session.userId);
  if(!user || (user.kind==='development' && process.env.ENABLE_DEVELOPMENT_BRIDGE!=='true'))throw Error('Sign in to continue');
  return session.userId;
}
export async function access(ctx: QueryCtx | MutationCtx, token: string, boardId: Id<'boards'>, edit = false) {
  const userId=await currentUser(ctx,token);
  return accessForUser(ctx,userId,boardId,edit);
}
export async function accessForUser(ctx: QueryCtx | MutationCtx, userId: Id<'users'>, boardId: Id<'boards'>, edit = false) {
  const board = await ctx.db.get(boardId);
  if (!board||board.archived) throw Error('Board not found');
  const member = await ctx.db.query('boardMembers').withIndex('board_user', q => q.eq('boardId', boardId).eq('userId', userId)).unique();
  let role: 'owner'|'editor'|'viewer'|null=board.ownerId===userId?'owner':member?.role||null;
  if(board.teamId){const teamMember=await ctx.db.query('teamMembers').withIndex('team_user',q=>q.eq('teamId',board.teamId!).eq('userId',userId)).unique();if(teamMember&&(!role||role==='viewer'))role='editor';}
  const grants=await ctx.db.query('linkMembers').withIndex('board_user',q=>q.eq('boardId',boardId).eq('userId',userId)).collect();
  for(const grant of grants){const link=await ctx.db.get(grant.linkId);if(link&&!link.revoked&&(!link.expiresAt||link.expiresAt>Date.now())){if(!role||role==='viewer')role=link.role;}}
  if (!role || (edit && role === 'viewer')) throw Error('Board access denied');
  return { userId, board, membership:{role} };
}
