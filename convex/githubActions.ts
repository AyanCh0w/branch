// Network side of the GitHub integration. User tokens are used once, to verify
// which installations and repositories a person can see, then revoked. Reads
// use short-lived installation tokens scoped to a single repository.
import { action, internalAction } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { v, ConvexError } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { githubConfigured } from './github';
import { appJWT, github, fileCard, issueCard, pullCard, repoCard, normalizeScope, inScope, scopeAllowsFolder, numberedFile, decodeFile } from '../collaboration/github.cjs';

const MAX_REPOS = 500;
const target = v.union(
  v.object({ kind: v.literal('file'), path: v.string() }),
  v.object({ kind: v.literal('issue'), number: v.number() }),
  v.object({ kind: v.literal('pull'), number: v.number() }),
  v.object({ kind: v.literal('repo') }),
);
type Link = { linkId: Id<'boardRepos'>; fullName: string; repoId: number; installationId: number; defaultBranch: string };
type Target = { kind: 'file'; path: string } | { kind: 'issue'; number: number } | { kind: 'pull'; number: number } | { kind: 'repo'; scope?: string[] };

function requireConfigured() { if (!githubConfigured()) throw new ConvexError('GitHub isn’t set up on this Branch yet.'); }
// Errors reach the browser as messages people can act on.
async function friendly<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error: any) { throw new ConvexError(error?.data || error?.message || 'GitHub request failed'); }
}

async function repoToken(link: Link) {
  const jwt = await appJWT(process.env.GITHUB_CLIENT_ID, process.env.GITHUB_PRIVATE_KEY);
  const result = await github('/app/installations/' + link.installationId + '/access_tokens', { method: 'POST', token: jwt, body: { repository_ids: [link.repoId], permissions: { contents: 'read', issues: 'read', pull_requests: 'read', metadata: 'read' } } });
  return result.token as string;
}
const repoPath = (link: Link) => '/repos/' + link.fullName.split('/').map(encodeURIComponent).join('/');
const filePath = (path: string) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/');

export const connect = action({
  args: { code: v.string(), redirectUri: v.string() },
  handler: (ctx, args) => friendly(async () => {
    requireConfigured();
    const userId = await ctx.runQuery(internal.github.viewer, {});
    if (!userId) throw Error('Sign in to Branch before connecting GitHub.');
    const exchange = await github('https://github.com/login/oauth/access_token', { method: 'POST', accept: 'application/json', body: { client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code: args.code, redirect_uri: args.redirectUri } });
    const token = exchange?.access_token;
    if (!token) throw Error(exchange?.error === 'bad_verification_code' ? 'That GitHub sign-in expired. Connect again.' : 'GitHub didn’t confirm the connection. Try again.');
    try {
      const user = await github('/user', { token });
      const repos: { id: number; fullName: string; private: boolean; defaultBranch: string; installationId: number }[] = [];
      // Only repositories this person can see through each installation: an
      // organization installation may cover repositories they can't access.
      for (let page = 1; page <= 5; page++) {
        const installations = await github('/user/installations?per_page=100&page=' + page, { token });
        for (const installation of installations.installations || []) {
          for (let repoPage = 1; repoPage <= 10 && repos.length < MAX_REPOS; repoPage++) {
            const result = await github('/user/installations/' + installation.id + '/repositories?per_page=100&page=' + repoPage, { token });
            for (const r of result.repositories || []) if (repos.length < MAX_REPOS) repos.push({ id: r.id, fullName: r.full_name, private: !!r.private, defaultBranch: r.default_branch || 'main', installationId: installation.id });
            if ((result.repositories || []).length < 100) break;
          }
        }
        if ((installations.installations || []).length < 100) break;
      }
      repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
      await ctx.runMutation(internal.github.saveConnection, { userId, githubId: String(user.id), login: user.login, avatarUrl: user.avatar_url || '', repos });
      return { login: user.login as string, repositories: repos.length };
    } finally {
      // The user token is not stored; revoke it now that it has done its job.
      const basic = btoa(process.env.GITHUB_CLIENT_ID + ':' + process.env.GITHUB_CLIENT_SECRET);
      await github('/applications/' + process.env.GITHUB_CLIENT_ID + '/token', { method: 'DELETE', token: basic, auth: 'Basic', body: { access_token: token } }).catch(() => {});
    }
  }),
});

async function linkFor(ctx: ActionCtx, args: { boardId: Id<'boards'>; token: string; linkId: Id<'boardRepos'> }): Promise<Link> {
  requireConfigured();
  return await ctx.runQuery(internal.github.repoForBoard, { boardId: args.boardId, token: args.token, linkId: args.linkId }) as Link;
}

export const browse = action({
  args: { boardId: v.id('boards'), token: v.string(), linkId: v.id('boardRepos'), path: v.string() },
  handler: (ctx, args) => friendly(async () => {
    const link = await linkFor(ctx, args);
    const token = await repoToken(link);
    const entries = await github(repoPath(link) + '/contents/' + filePath(args.path) + '?ref=' + encodeURIComponent(link.defaultBranch), { token });
    if (!Array.isArray(entries)) throw Error('That path is a file, not a folder.');
    return entries
      .filter((e: any) => e.type === 'dir' || e.type === 'file')
      .map((e: any) => ({ type: e.type as 'dir' | 'file', name: e.name as string, path: e.path as string, size: e.size as number }))
      .sort((a: any, b: any) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  }),
});

export const items = action({
  args: { boardId: v.id('boards'), token: v.string(), linkId: v.id('boardRepos'), kind: v.union(v.literal('issue'), v.literal('pull')), search: v.string() },
  handler: (ctx, args): Promise<{ number: number; title: string; state: string; author: string; updatedAt: string }[]> => friendly(async () => {
    const link = await linkFor(ctx, args);
    const token = await repoToken(link);
    const terms = args.search.trim().slice(0, 120);
    const results: any[] = terms
      ? (await github('/search/issues?per_page=30&q=' + encodeURIComponent('repo:' + link.fullName + ' is:' + (args.kind === 'pull' ? 'pr' : 'issue') + ' ' + terms), { token })).items
      : (await github(repoPath(link) + '/' + (args.kind === 'pull' ? 'pulls' : 'issues') + '?state=open&sort=updated&per_page=30', { token }));
    return (results || [])
      .filter((i: any) => args.kind === 'pull' || !i.pull_request)
      .map((i: any) => ({ number: i.number as number, title: i.title as string, state: (i.merged_at || i.pull_request?.merged_at ? 'merged' : i.draft ? 'draft' : i.state) as string, author: (i.user?.login || '') as string, updatedAt: i.updated_at as string }));
  }),
});

async function fetchRepoCard(link: Link, token: string, scope: string[]) {
  const base = repoPath(link);
  const info = await github(base, { token });
  const [tree, readme] = await Promise.all([
    github(base + '/git/trees/' + encodeURIComponent(info.default_branch) + '?recursive=1', { token }).catch(() => ({ tree: [], truncated: true })),
    github(base + '/readme?ref=' + encodeURIComponent(info.default_branch), { token, accept: 'application/vnd.github.raw' }).catch(() => ''),
  ]);
  return repoCard(info, tree, typeof readme === 'string' ? readme : '', scope);
}

async function fetchCard(link: Link, item: Target) {
  const token = await repoToken(link);
  const base = repoPath(link);
  if (item.kind === 'repo') return fetchRepoCard(link, token, normalizeScope(item.scope));
  if (item.kind === 'file') return fileCard(link.fullName, await github(base + '/contents/' + filePath(item.path) + '?ref=' + encodeURIComponent(link.defaultBranch), { token }), link.defaultBranch);
  if (item.kind === 'issue') {
    const issue = await github(base + '/issues/' + item.number, { token });
    if (issue.pull_request) throw Error('#' + item.number + ' is a pull request.');
    return issueCard(link.fullName, issue, issue.comments ? await github(base + '/issues/' + item.number + '/comments?per_page=50', { token }) : []);
  }
  const pull = await github(base + '/pulls/' + item.number, { token });
  const [files, comments] = await Promise.all([github(base + '/pulls/' + item.number + '/files?per_page=100', { token }), pull.comments ? github(base + '/issues/' + item.number + '/comments?per_page=50', { token }) : []]);
  return pullCard(link.fullName, pull, files, comments);
}

export const addCard = action({
  args: { boardId: v.id('boards'), token: v.string(), linkId: v.id('boardRepos'), target, key: v.string(), x: v.number(), y: v.number() },
  handler: (ctx, args) => friendly(async () => {
    const link = await linkFor(ctx, args);
    if (args.target.kind === 'file' && !args.target.path.trim()) throw Error('Choose a file');
    const card = await fetchCard(link, args.target);
    await ctx.runMutation(internal.github.insertCard, { boardId: args.boardId, token: args.token, key: args.key, x: args.x, y: args.y, title: card.title, text: card.text, github: card.github });
    return { key: args.key, title: card.title };
  }),
});

export const refreshCard = action({
  args: { boardId: v.id('boards'), token: v.string(), nodeKey: v.string() },
  handler: (ctx, args): Promise<{ changed: boolean }> => friendly(async () => {
    requireConfigured();
    const { github: meta, link } = await ctx.runQuery(internal.github.cardForRefresh, args) as { github: any; link: Link };
    const item: Target = meta.kind === 'repo' ? { kind: 'repo', scope: meta.scope || [] } : meta.kind === 'file' ? { kind: 'file', path: meta.path } : { kind: meta.kind, number: meta.number };
    const card = await fetchCard(link, item);
    return ctx.runMutation(internal.github.updateCard, { boardId: args.boardId, token: args.token, nodeKey: args.nodeKey, text: card.text, github: card.github });
  }),
});

// Limit a repository card (and every chat that later connects to it) to some folders.
export const setRepoScope = action({
  args: { boardId: v.id('boards'), token: v.string(), nodeKey: v.string(), folders: v.array(v.string()) },
  handler: (ctx, args): Promise<{ changed: boolean }> => friendly(async () => {
    requireConfigured();
    const { github: meta, link } = await ctx.runQuery(internal.github.cardForRefresh, { boardId: args.boardId, token: args.token, nodeKey: args.nodeKey }) as { github: any; link: Link };
    if (meta.kind !== 'repo') throw Error('Only repository cards have folder limits.');
    const scope = normalizeScope(args.folders);
    const card = await fetchCard(link, { kind: 'repo', scope });
    if (scope.length && (card.github as any).files === 0) throw Error('No files found in ' + scope.map(f => f + '/').join(', ') + '.');
    return ctx.runMutation(internal.github.updateCard, { boardId: args.boardId, token: args.token, nodeKey: args.nodeKey, text: card.text, github: card.github });
  }),
});

// Read-only repository tools for chat runs. The run's initiator must still be
// able to edit the board, the repository must still be linked to it, and every
// path must fall inside the scope frozen into the chat's context.
export const runTool = internalAction({
  args: { runId: v.id('runs'), name: v.string(), args: v.any() },
  handler: async (ctx, args): Promise<any> => {
    requireConfigured();
    const call = args.args || {};
    const { link, scope } = await ctx.runQuery(internal.github.repoForRun, { runId: args.runId, repo: String(call.repo || '') }) as { link: Link; scope: string[] };
    const token = await repoToken(link);
    const base = repoPath(link);
    const ref = '?ref=' + encodeURIComponent(link.defaultBranch);
    const clean = (path: any) => String(path || '').trim().replace(/^\/+|\/+$/g, '');
    if (args.name === 'github_list_files') {
      const path = clean(call.path);
      if (!scopeAllowsFolder(path, scope)) throw Error('That folder is outside this repository card’s limits: ' + scope.join(', '));
      const entries = await github(base + '/contents/' + filePath(path) + ref, { token });
      if (!Array.isArray(entries)) throw Error('That path is a file. Use github_read_file.');
      return { repo: link.fullName, path, entries: entries.filter((e: any) => (e.type === 'dir' ? scopeAllowsFolder(e.path, scope) : inScope(e.path, scope))).map((e: any) => ({ type: e.type === 'dir' ? 'folder' : 'file', path: e.path, size: e.size })) };
    }
    if (args.name === 'github_read_file') {
      const path = clean(call.path);
      if (!path || !inScope(path, scope)) throw Error('That file is outside this repository card’s limits: ' + scope.join(', '));
      const content = decodeFile(await github(base + '/contents/' + filePath(path) + ref, { token }));
      await ctx.runMutation(internal.github.recordRead, { runId: args.runId, repo: link.fullName, path });
      return { repo: link.fullName, ...numberedFile(path, content, call.start_line, call.end_line) };
    }
    if (args.name === 'github_search_code') {
      const query = String(call.query || '').replace(/[\n\r]/g, ' ').trim().slice(0, 200);
      if (!query) throw Error('Give a search query.');
      let items: any[] = [];
      try { items = (await github('/search/code?per_page=30&q=' + encodeURIComponent(query + ' repo:' + link.fullName), { token, accept: 'application/vnd.github.text-match+json' })).items || []; }
      catch (error: any) { return { repo: link.fullName, results: [], note: 'Code search is unavailable right now (' + error.message + '). Browse with github_list_files instead.' }; }
      return { repo: link.fullName, note: 'GitHub code search covers the default branch.', results: items.filter((i: any) => inScope(i.path, scope)).slice(0, 20).map((i: any) => ({ path: i.path, matches: (i.text_matches || []).map((m: any) => String(m.fragment || '').slice(0, 300)).slice(0, 3) })) };
    }
    throw Error('Unknown GitHub tool');
  },
});
