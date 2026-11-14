// GitHub as a context source. A person connects GitHub (verified with a
// one-time user authorization), links repositories they can access to a
// board, and board editors add files, issues and pull requests as cards.
// Card content is fetched by the server, never written by clients.
import { query, mutation, internalQuery, internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import { access, accessForUser, touchBoard } from './access';
import { initialDocument } from './documents';

export const MAX_BOARD_REPOS = 10;
const repo = v.object({ id: v.number(), fullName: v.string(), private: v.boolean(), defaultBranch: v.string(), installationId: v.number() });

export function githubConfigured() {
  return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && process.env.GITHUB_PRIVATE_KEY && process.env.GITHUB_APP_SLUG);
}

// Public app identity for the browser: the OAuth client ID and install page are not secrets.
export const config = query({
  args: {},
  handler: async () => githubConfigured()
    ? { enabled: true, clientId: process.env.GITHUB_CLIENT_ID!, installURL: 'https://github.com/apps/' + process.env.GITHUB_APP_SLUG + '/installations/new' }
    : { enabled: false as const },
});

export const connection = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db.query('githubConnections').withIndex('user', q => q.eq('userId', userId)).unique();
    if (!row) return { connected: false as const };
    return { connected: true as const, login: row.login, avatarUrl: row.avatarUrl || '', repos: row.repos.map(({ installationId: _, ...r }) => r), updatedAt: row.updatedAt };
  },
});

export const disconnect = mutation({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw Error('Sign in first');
    const row = await ctx.db.query('githubConnections').withIndex('user', q => q.eq('userId', userId)).unique();
    if (row) await ctx.db.delete(row._id);
    // Repositories this person linked stop working on every board. Cards stay.
    for (const link of await ctx.db.query('boardRepos').withIndex('added_by', q => q.eq('addedBy', userId)).collect()) await ctx.db.delete(link._id);
  },
});

export const viewer = internalQuery({ args: {}, handler: async ctx => await getAuthUserId(ctx) });

export const saveConnection = internalMutation({
  args: { userId: v.id('users'), githubId: v.string(), login: v.string(), avatarUrl: v.string(), repos: v.array(repo) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('githubConnections').withIndex('user', q => q.eq('userId', args.userId)).unique();
    const data = { ...args, updatedAt: Date.now() };
    if (existing) await ctx.db.replace(existing._id, data); else await ctx.db.insert('githubConnections', data);
    // A repository the person lost access to can't stay linked through them.
    const allowed = new Set(args.repos.map(r => r.installationId + ':' + r.id));
    for (const link of await ctx.db.query('boardRepos').withIndex('added_by', q => q.eq('addedBy', args.userId)).collect()) {
      if (!allowed.has(link.installationId + ':' + link.repoId)) await ctx.db.delete(link._id);
    }
  },
});

export const boardRepos = query({
  args: { boardId: v.id('boards'), token: v.string() },
  handler: async (ctx, args) => {
    const { userId, membership } = await access(ctx, args.token, args.boardId);
    const links = await ctx.db.query('boardRepos').withIndex('board', q => q.eq('boardId', args.boardId)).collect();
    return Promise.all(links.map(async l => ({ id: l._id, fullName: l.fullName, private: l.private, defaultBranch: l.defaultBranch, addedBy: (await ctx.db.get(l.addedBy))?.name || 'Someone', canRemove: membership.role !== 'viewer' && (l.addedBy === userId || membership.role === 'owner') })));
  },
});

export const linkRepo = mutation({
  args: { boardId: v.id('boards'), repoId: v.number() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw Error('Sign in to link a repository');
    await access(ctx, '', args.boardId, true);
    const connection = await ctx.db.query('githubConnections').withIndex('user', q => q.eq('userId', userId)).unique();
    const found = connection?.repos.find(r => r.id === args.repoId);
    if (!found) throw Error('Connect GitHub with access to this repository first.');
    const links = await ctx.db.query('boardRepos').withIndex('board', q => q.eq('boardId', args.boardId)).collect();
    const existing = links.find(l => l.repoId === args.repoId);
    if (existing) return existing._id;
    if (links.length >= MAX_BOARD_REPOS) throw Error('A board can link up to ' + MAX_BOARD_REPOS + ' repositories.');
    return ctx.db.insert('boardRepos', { boardId: args.boardId, repoId: found.id, fullName: found.fullName, private: found.private, defaultBranch: found.defaultBranch, installationId: found.installationId, addedBy: userId, createdAt: Date.now() });
  },
});

export const unlinkRepo = mutation({
  args: { boardId: v.id('boards'), token: v.string(), linkId: v.id('boardRepos') },
  handler: async (ctx, args) => {
    const { userId, membership } = await access(ctx, args.token, args.boardId, true);
    const link = await ctx.db.get(args.linkId);
    if (!link || link.boardId !== args.boardId) throw Error('Repository not found');
    if (link.addedBy !== userId && membership.role !== 'owner') throw Error('Only the person who linked this repository or the board owner can remove it.');
    await ctx.db.delete(link._id);
  },
});

// Authorizes a board editor to read through a linked repository.
export const repoForBoard = internalQuery({
  args: { boardId: v.id('boards'), token: v.string(), linkId: v.id('boardRepos') },
  handler: async (ctx, args) => {
    await access(ctx, args.token, args.boardId, true);
    const link = await ctx.db.get(args.linkId);
    if (!link || link.boardId !== args.boardId) throw Error('This repository is no longer linked to the board.');
    return { linkId: link._id, fullName: link.fullName, repoId: link.repoId, installationId: link.installationId, defaultBranch: link.defaultBranch };
  },
});

export const cardForRefresh = internalQuery({
  args: { boardId: v.id('boards'), token: v.string(), nodeKey: v.string() },
  handler: async (ctx, args) => {
    await access(ctx, args.token, args.boardId, true);
    const node = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', args.boardId).eq('key', args.nodeKey)).unique();
    if (!node || node.deleted || node.data.type !== 'github') throw Error('GitHub card not found');
    const links = await ctx.db.query('boardRepos').withIndex('board', q => q.eq('boardId', args.boardId)).collect();
    const link = links.find(l => l.fullName.toLowerCase() === String(node.data.github.repo).toLowerCase());
    if (!link) throw Error('Link ' + node.data.github.repo + ' to this board again to refresh this card.');
    return { github: node.data.github, link: { linkId: link._id, fullName: link.fullName, repoId: link.repoId, installationId: link.installationId, defaultBranch: link.defaultBranch } };
  },
});

export const insertCard = internalMutation({
  args: { boardId: v.id('boards'), token: v.string(), key: v.string(), x: v.number(), y: v.number(), title: v.string(), text: v.string(), github: v.any() },
  handler: async (ctx, args) => {
    const { userId } = await access(ctx, args.token, args.boardId, true);
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(args.key)) throw Error('Invalid card');
    const existing = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', args.boardId).eq('key', args.key)).unique();
    if (existing) return args.key;
    const user = await ctx.db.get(userId);
    const data = { id: args.key, type: 'github', title: args.title.slice(0, 200), x: args.x, y: args.y, width: 460, revision: 1, text: args.text, author: user?.name || 'You', github: { ...args.github, fetchedAt: Date.now() } };
    await ctx.db.insert('nodes', { boardId: args.boardId, key: args.key, data, textState: initialDocument(data), textVersion: 0, createdBy: userId, updatedBy: userId, deleted: false });
    await touchBoard(ctx, args.boardId);
    return args.key;
  },
});

export const updateCard = internalMutation({
  args: { boardId: v.id('boards'), token: v.string(), nodeKey: v.string(), text: v.string(), github: v.any() },
  handler: async (ctx, args) => {
    const { userId } = await access(ctx, args.token, args.boardId, true);
    const node = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', args.boardId).eq('key', args.nodeKey)).unique();
    if (!node || node.deleted || node.data.type !== 'github') throw Error('GitHub card not found');
    const changed = node.data.text !== args.text || node.data.github?.state !== args.github.state;
    // A new revision marks chats holding the old snapshot as stale; they refresh explicitly.
    await ctx.db.patch(node._id, { updatedBy: userId, data: { ...node.data, text: args.text, github: { ...args.github, fetchedAt: Date.now() }, ...(changed ? { revision: (node.data.revision || 1) + 1 } : {}) } });
    return { changed };
  },
});

// Which repository a chat run may read, and within which folders. Both come
// from the context frozen at Send; the link must still exist on the board.
export const repoForRun = internalQuery({
  args: { runId: v.id('runs'), repo: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== 'streaming') throw Error('This chat is no longer running.');
    await accessForUser(ctx, run.initiatedBy, run.boardId, true);
    const wanted = args.repo.toLowerCase();
    const bindings = (run.input.contexts || []).filter((c: any) => c.githubRepo && String(c.githubRepo.repo).toLowerCase() === wanted);
    if (!bindings.length) throw Error('Repository ' + args.repo + ' isn’t connected to this chat.');
    const links = await ctx.db.query('boardRepos').withIndex('board', q => q.eq('boardId', run.boardId)).collect();
    const link = links.find(l => l.fullName.toLowerCase() === wanted);
    if (!link) throw Error(args.repo + ' is no longer linked to this board.');
    // Several cards for the same repository: allow the union of their limits; any unlimited card allows everything.
    const scopes = bindings.map((c: any) => c.githubRepo.scope || []);
    const scope = scopes.some((s: string[]) => !s.length) ? [] : [...new Set(scopes.flat())] as string[];
    return { link: { linkId: link._id, fullName: link.fullName, repoId: link.repoId, installationId: link.installationId, defaultBranch: link.defaultBranch }, scope };
  },
});

// Shows which files a reply read, on the reply itself.
export const recordRead = internalMutation({
  args: { runId: v.id('runs'), repo: v.string(), path: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== 'streaming') return;
    const node = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', run.boardId).eq('key', run.nodeKey)).unique();
    if (!node || node.data.activeRun !== run._id) return;
    const messages = (node.data.messages || []).map((m: any) => {
      if (m.id !== run.assistantId) return m;
      const reads = m.githubReads || [];
      if (reads.length >= 50 || reads.some((r: any) => r.repo === args.repo && r.path === args.path)) return m;
      return { ...m, githubReads: [...reads, { repo: args.repo, path: args.path }] };
    });
    await ctx.db.patch(node._id, { data: { ...node.data, messages } });
  },
});
