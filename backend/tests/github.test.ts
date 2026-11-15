// GitHub as board context on the Supabase backend: connect, link, browse,
// server-authored cards, repository scope, and chat repository tools.
import {it,expect,vi,afterEach,beforeEach,describe} from 'vitest';
import {generateKeyPairSync,createPublicKey,verify} from 'node:crypto';
import {harness} from './harness';
import {decode} from '../codec';
import {appJWT,fileCard} from '../../collaboration/github.cjs';
import {textOf,snapshotNode} from '../../app/context.js';

const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs1',format:'pem'}});
let h:any;
beforeEach(async()=>{h=await harness();});
afterEach(async()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();await h?.close();});

const b64 = (text: string) => Buffer.from(text).toString('base64');
const REPO = { id: 101, full_name: 'acme/app', private: true, default_branch: 'main' };
const OTHER = { id: 202, full_name: 'acme/secret', private: true, default_branch: 'main' };

// A stand-in for GitHub. Records calls; routes by method and path.
function fakeGitHub(overrides: Record<string, any> = {}) {
  const calls: { method: string; url: string; body: any; auth: string }[] = [];
  const routes: Record<string, any> = {
    'POST https://github.com/login/oauth/access_token': (body: any) => body.code === 'good-code' ? { access_token: 'user-token' } : { error: 'bad_verification_code' },
    'GET /user': { id: 7, login: 'octo', avatar_url: 'https://avatars/octo' },
    'GET /user/installations?per_page=100&page=1': { installations: [{ id: 55 }] },
    'GET /user/installations/55/repositories?per_page=100&page=1': { repositories: [REPO] },
    'DELETE /applications/Iv-client/token': null,
    'POST /app/installations/55/access_tokens': { token: 'installation-token' },
    'GET /repos/acme/app/contents/?ref=main': [{ type: 'file', name: 'README.md', path: 'README.md', size: 20 }, { type: 'dir', name: 'src', path: 'src', size: 0 }],
    'GET /repos/acme/app/contents/src/main.ts?ref=main': { type: 'file', path: 'src/main.ts', size: 30, sha: 'abc1234def', html_url: 'https://github.com/acme/app/blob/main/src/main.ts', content: b64('export const answer = 42;\n') },
    'GET /repos/acme/app/contents/logo.png?ref=main': { type: 'file', path: 'logo.png', size: 4, sha: 'x', html_url: 'https://github.com/acme/app/blob/main/logo.png', content: Buffer.from([0x89, 0x50, 0x00, 0xff]).toString('base64') },
    'GET /repos/acme/app/issues?state=open&sort=updated&per_page=30': [{ number: 3, title: 'Login breaks', state: 'open', user: { login: 'amy' }, updated_at: 'now' }, { number: 4, title: 'A PR', state: 'open', pull_request: {}, user: { login: 'bo' } }],
    'GET /repos/acme/app/issues/3': { number: 3, title: 'Login breaks', state: 'open', body: 'Steps to reproduce', user: { login: 'amy' }, labels: [{ name: 'bug' }], comments: 1, html_url: 'https://github.com/acme/app/issues/3' },
    'GET /repos/acme/app/issues/3/comments?per_page=50': [{ user: { login: 'bo' }, body: 'Confirmed on Safari' }],
    'GET /repos/acme/app/pulls/9': { number: 9, title: 'Fix login', state: 'open', body: 'Fixes #3', user: { login: 'bo' }, base: { ref: 'main' }, head: { ref: 'fix-login' }, additions: 3, deletions: 1, changed_files: 1, comments: 0, html_url: 'https://github.com/acme/app/pull/9' },
    'GET /repos/acme/app/pulls/9/files?per_page=100': [{ filename: 'src/login.ts', status: 'modified', additions: 3, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' }],
    'GET /repos/acme/app': { full_name: 'acme/app', default_branch: 'main', description: 'The Acme app', private: true, html_url: 'https://github.com/acme/app', language: 'TypeScript' },
    'GET /repos/acme/app/git/trees/main?recursive=1': { truncated: false, tree: [{ type: 'tree', path: 'src' }, { type: 'blob', path: 'src/main.ts' }, { type: 'tree', path: 'docs' }, { type: 'blob', path: 'docs/guide.md' }, { type: 'blob', path: 'README.md' }, { type: 'tree', path: 'src/lib' }, { type: 'blob', path: 'src/lib/util.ts' }] },
    'GET /repos/acme/app/readme?ref=main': { raw: '# Acme\n\nStart with `src/main.ts`.' },
    'GET /repos/acme/app/contents/src?ref=main': [{ type: 'file', name: 'main.ts', path: 'src/main.ts', size: 30 }, { type: 'dir', name: 'lib', path: 'src/lib', size: 0 }],
    'GET /repos/acme/app/contents/docs/guide.md?ref=main': { type: 'file', path: 'docs/guide.md', size: 10, content: b64('Guide') },
    ...overrides,
  };
  const stub = vi.fn(async (input: string, init: any = {}) => {
    if (input.startsWith('https://api.openai.com/')) return routes.openai(JSON.parse(init.body));
    const method = init.method || 'GET', url = input.replace('https://api.github.com', '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url, body, auth: init.headers?.Authorization || '' });
    const route = routes[method + ' ' + url];
    if (route === undefined) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    const value = typeof route === 'function' ? route(body, input) : route;
    if (value && typeof value === 'object' && 'raw' in value) return new Response(value.raw, { status: 200 });
    return route === null ? new Response(null, { status: 204 }) : new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', stub);
  return { calls, routes };
}

async function setup() {
  for (const [k, value] of Object.entries({ GITHUB_CLIENT_ID: 'Iv-client', GITHUB_CLIENT_SECRET: 'secret', GITHUB_PRIVATE_KEY: privateKey, GITHUB_APP_SLUG: 'branch-app' })) vi.stubEnv(k, value);
  const ownerId = await h.account('owner'), otherId = await h.account('other');
  const as = (identity: any) => ({
    query: (name: string, args: any = {}) => h.call(identity, name, args, 'query'),
    mutation: (name: string, args: any = {}) => h.call(identity, name, args, 'mutation'),
    action: (name: string, args: any = {}) => h.call(identity, name, args, 'action'),
  });
  const owner = as(ownerId), other = as(otherId), anonymous = as({});
  const internal = (name: string, args: any, kind = 'action') => h.engine.call(name, args, {}, kind, true);
  const boardId = await owner.mutation('library:create', { title: 'Project' });
  const board = { boardId, token: '' };
  const github = fakeGitHub();
  const connectAndLink = async () => {
    await owner.action('githubActions:connect', { code: 'good-code', redirectUri: 'http://127.0.0.1:4387/app' });
    return owner.mutation('github:linkRepo', { boardId, repoId: REPO.id });
  };
  const nodes = async () => (await owner.query('boards:read', board)).nodes;
  // Runs scheduled work the way the worker does, until nothing is left.
  const drain = async () => {
    for (let i = 0; i < 20; i++) {
      const { rows } = await h.pool.query("update branch_private.jobs set status='complete' where id=(select id from branch_private.jobs where status='pending' order by due_at limit 1) returning function_name,args");
      if (!rows[0]) return;
      await internal(rows[0].function_name, decode(rows[0].args));
    }
    throw Error('Scheduled work did not settle');
  };
  return { owner, other, anonymous, internal, boardId, board, github, connectAndLink, nodes, drain };
}

describe('GitHub app authentication', () => {
  it('signs a valid RS256 app JWT from GitHub’s PKCS#1 key', async () => {
    const jwt = await appJWT('Iv-client', privateKey, 1000);
    const [h, p, s] = jwt.split('.');
    expect(verify('RSA-SHA256', Buffer.from(h + '.' + p), createPublicKey(privateKey), Buffer.from(s, 'base64url'))).toBe(true);
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ iat: 940, exp: 1540, iss: 'Iv-client' });
    // Escaped newlines, as some hosts store multi-line values, also work.
    await expect(appJWT('Iv-client', String(privateKey).replace(/\n/g, '\\n'))).resolves.toMatch(/^ey/);
    await expect(appJWT('Iv-client', 'not a key')).rejects.toThrow(/PEM/);
  });
});

describe('GitHub connection', () => {
  it('is disabled until the app is configured', async () => {
    const { anonymous, owner, board, connectAndLink } = await setup();
    await connectAndLink();
    expect(await anonymous.query('github:config', {})).toEqual({ enabled: true, clientId: 'Iv-client', installURL: 'https://github.com/apps/branch-app/installations/new' });
    vi.stubEnv('GITHUB_PRIVATE_KEY', '');
    expect(await anonymous.query('github:config', {})).toEqual({ enabled: false });
    // Boards keep opening while GitHub is switched off, without reading its tables.
    expect(await owner.query('github:boardRepos', board)).toEqual([]);
    expect(await owner.query('github:connection', {})).toBeNull();
  });

  it('verifies repositories with a one-time user token, then revokes it', async () => {
    const { anonymous, owner, github } = await setup();
    await expect(anonymous.action('githubActions:connect', { code: 'good-code', redirectUri: 'x' })).rejects.toThrow(/Sign in/);
    await expect(owner.action('githubActions:connect', { code: 'stale', redirectUri: 'x' })).rejects.toThrow(/expired/);
    expect(await owner.action('githubActions:connect', { code: 'good-code', redirectUri: 'http://127.0.0.1:4387/app' })).toEqual({ login: 'octo', repositories: 1 });
    const connection = await owner.query('github:connection', {});
    expect(connection).toMatchObject({ connected: true, login: 'octo', repos: [{ id: 101, fullName: 'acme/app', private: true, defaultBranch: 'main' }] });
    expect(JSON.stringify(connection)).not.toContain('installation');
    const revoke = github.calls.find(c => c.method === 'DELETE');
    expect(revoke).toMatchObject({ url: '/applications/Iv-client/token', body: { access_token: 'user-token' } });
    expect(revoke!.auth).toMatch(/^Basic /);
    expect(JSON.stringify((await h.pool.query('select * from branch_private.github_connections')).rows)).not.toContain('user-token');
  });

  it('only links repositories the person verified, and only for editors', async () => {
    const { owner, other, boardId, connectAndLink } = await setup();
    await expect(owner.mutation('github:linkRepo', { boardId, repoId: REPO.id })).rejects.toThrow(/Connect GitHub/);
    const linkId = await connectAndLink();
    expect(await owner.mutation('github:linkRepo', { boardId, repoId: REPO.id })).toBe(linkId);
    await expect(owner.mutation('github:linkRepo', { boardId, repoId: OTHER.id })).rejects.toThrow(/Connect GitHub/);
    await expect(other.mutation('github:linkRepo', { boardId, repoId: REPO.id })).rejects.toThrow(/denied/);
    await owner.mutation('sharing:addMember', { boardId, username: 'other', role: 'viewer' });
    expect(await other.query('github:boardRepos', { boardId, token: '' })).toMatchObject([{ fullName: 'acme/app', canRemove: false }]);
    await expect(other.action('githubActions:browse', { boardId, token: '', linkId, path: '' })).rejects.toThrow(/denied/);
  });

  it('drops board links when access shrinks or GitHub is disconnected', async () => {
    const { owner, boardId, github, connectAndLink } = await setup();
    await connectAndLink();
    github.routes['GET /user/installations/55/repositories?per_page=100&page=1'] = { repositories: [OTHER] };
    await owner.action('githubActions:connect', { code: 'good-code', redirectUri: 'x' });
    expect(await owner.query('github:boardRepos', { boardId, token: '' })).toEqual([]);
    await owner.mutation('github:linkRepo', { boardId, repoId: OTHER.id });
    await owner.mutation('github:disconnect', {});
    expect(await owner.query('github:boardRepos', { boardId, token: '' })).toEqual([]);
    expect(await owner.query('github:connection', {})).toEqual({ connected: false });
  });
});

describe('GitHub cards', () => {
  it('browses with an installation token scoped to the one repository', async () => {
    const { owner, board, github, connectAndLink } = await setup();
    const linkId = await connectAndLink();
    expect(await owner.action('githubActions:browse', { ...board, linkId, path: '' })).toEqual([{ type: 'dir', name: 'src', path: 'src', size: 0 }, { type: 'file', name: 'README.md', path: 'README.md', size: 20 }]);
    const mint = github.calls.filter(c => c.url === '/app/installations/55/access_tokens').at(-1)!;
    expect(mint.body).toEqual({ repository_ids: [101], permissions: { contents: 'read', issues: 'read', pull_requests: 'read', metadata: 'read' } });
    expect(mint.auth).toMatch(/^Bearer ey/);
    expect(github.calls.at(-1)!.auth).toBe('Bearer installation-token');
    expect(await owner.action('githubActions:items', { ...board, linkId, kind: 'issue', search: '' })).toEqual([{ number: 3, title: 'Login breaks', state: 'open', author: 'amy', updatedAt: 'now' }]);
  });

  it('adds file, issue and pull request cards that feed chat context', async () => {
    const { owner, board, connectAndLink } = await setup();
    const linkId = await connectAndLink();
    await owner.action('githubActions:addCard', { ...board, linkId, target: { kind: 'file', path: 'src/main.ts' }, key: 'gh-file-1', x: 10, y: 20 });
    await owner.action('githubActions:addCard', { ...board, linkId, target: { kind: 'issue', number: 3 }, key: 'gh-issue-1', x: 0, y: 0 });
    await owner.action('githubActions:addCard', { ...board, linkId, target: { kind: 'pull', number: 9 }, key: 'gh-pull-1', x: 0, y: 0 });
    const nodes = (await owner.query('boards:read', board)).nodes;
    const file = nodes.find((n: any) => n.id === 'gh-file-1')!, issue = nodes.find((n: any) => n.id === 'gh-issue-1')!, pull = nodes.find((n: any) => n.id === 'gh-pull-1')!;
    expect(file).toMatchObject({ type: 'github', title: 'src/main.ts', x: 10, y: 20, text: 'export const answer = 42;\n', github: { kind: 'file', repo: 'acme/app', ref: 'main', language: 'typescript' } });
    expect(textOf(file)).toContain('GitHub file acme/app/src/main.ts (branch main)');
    expect(textOf(file)).toContain('```typescript\nexport const answer = 42;');
    expect(issue).toMatchObject({ title: '#3 Login breaks', github: { kind: 'issue', state: 'open', author: 'amy', labels: ['bug'] } });
    expect(issue.text).toContain('@bo commented:\nConfirmed on Safari');
    expect(textOf(issue)).toContain('GitHub issue acme/app#3 (open, opened by @amy)');
    expect(pull).toMatchObject({ title: '#9 Fix login', github: { kind: 'pull', head: 'fix-login', base: 'main', additions: 3 } });
    expect(pull.text).toContain('#### src/login.ts (modified, +3 −1)\n```diff');
    await expect(owner.action('githubActions:addCard', { ...board, linkId, target: { kind: 'issue', number: 4 }, key: 'gh-x', x: 0, y: 0 })).rejects.toThrow();
    await expect(owner.action('githubActions:addCard', { ...board, linkId, target: { kind: 'file', path: 'logo.png' }, key: 'gh-png', x: 0, y: 0 })).rejects.toThrow(/binary/);
  });

  it('keeps card content server-authored and refreshes it with a new revision', async () => {
    const { owner, board, github, connectAndLink } = await setup();
    const linkId = await connectAndLink();
    await owner.action('githubActions:addCard', { ...board, linkId, target: { kind: 'file', path: 'src/main.ts' }, key: 'gh-file-1', x: 0, y: 0 });
    await owner.mutation('boards:patchNodes', { ...board, changes: [{ id: 'gh-file-1', patch: { text: 'forged', x: 99 } }] });
    let card = (await owner.query('boards:read', board)).nodes[0];
    expect(card).toMatchObject({ text: 'export const answer = 42;\n', x: 99, revision: 1 });
    await expect(owner.mutation('boards:patchNodes', { ...board, changes: [{ id: 'gh-new', create: { type: 'github', text: 'forged' } }] })).rejects.toThrow(/Invalid node type/);
    expect(await owner.action('githubActions:refreshCard', { ...board, nodeKey: 'gh-file-1' })).toEqual({ changed: false });
    github.routes['GET /repos/acme/app/contents/src/main.ts?ref=main'] = { ...github.routes['GET /repos/acme/app/contents/src/main.ts?ref=main'], sha: 'new', content: b64('export const answer = 43;\n') };
    expect(await owner.action('githubActions:refreshCard', { ...board, nodeKey: 'gh-file-1' })).toEqual({ changed: true });
    card = (await owner.query('boards:read', board)).nodes[0];
    expect(card).toMatchObject({ text: 'export const answer = 43;\n', revision: 2, github: { sha: 'new' } });
  });

  it('stops reading once the repository is unlinked', async () => {
    const { owner, board, boardId, connectAndLink } = await setup();
    const linkId = await connectAndLink();
    await owner.action('githubActions:addCard', { ...board, linkId, target: { kind: 'issue', number: 3 }, key: 'gh-issue-1', x: 0, y: 0 });
    await owner.mutation('github:unlinkRepo', { boardId, token: '', linkId });
    await expect(owner.action('githubActions:browse', { ...board, linkId, path: '' })).rejects.toThrow(/no longer linked/);
    await expect(owner.action('githubActions:refreshCard', { ...board, nodeKey: 'gh-issue-1' })).rejects.toThrow(/Link acme\/app/);
  });
});

it('truncates very large files and rejects folders', () => {
  const big = { type: 'file', path: 'big.txt', size: 200000, sha: 's', html_url: 'u', content: b64('x'.repeat(150000)) };
  expect(fileCard('a/b', big, 'main')).toMatchObject({ github: { truncated: true } });
  expect(fileCard('a/b', big, 'main').text).toHaveLength(100000);
  expect(() => fileCard('a/b', { type: 'dir' }, 'main')).toThrow(/folder/);
});

describe('Repository cards', () => {
  it('summarizes the whole repository and its README as one card', async () => {
    const { owner, board, connectAndLink } = await setup();
    const linkId = await connectAndLink();
    await owner.action('githubActions:addCard', { ...board, linkId, target: { kind: 'repo' }, key: 'gh-repo-1', x: 0, y: 0 });
    const card = (await owner.query('boards:read', board)).nodes[0];
    expect(card).toMatchObject({ type: 'github', title: 'acme/app', github: { kind: 'repo', repo: 'acme/app', ref: 'main', scope: [], files: 4, folders: ['src', 'docs'], description: 'The Acme app' } });
    expect(card.text).toContain('Scope: whole repository.');
    expect(card.text).toContain('src/lib/util.ts');
    expect(card.text).toContain('### README\n\n# Acme');
    const snapshot = snapshotNode(card, [card]);
    expect(snapshot).toMatchObject({ githubRepo: { repo: 'acme/app', ref: 'main', scope: [] }, fromGitHub: true });
    expect(textOf(card)).toContain('github_read_file');
  });

  it('limits a repository card to folders and bumps its revision', async () => {
    const { owner, board, connectAndLink } = await setup();
    const linkId = await connectAndLink();
    await owner.action('githubActions:addCard', { ...board, linkId, target: { kind: 'repo' }, key: 'gh-repo-1', x: 0, y: 0 });
    expect(await owner.action('githubActions:setRepoScope', { ...board, nodeKey: 'gh-repo-1', folders: ['/src/'] })).toEqual({ changed: true });
    const card = (await owner.query('boards:read', board)).nodes[0];
    expect(card).toMatchObject({ revision: 2, github: { scope: ['src'], files: 2 } });
    expect(card.text).toContain('Scope: only src/.');
    expect(card.text).not.toContain('docs/guide.md');
    await expect(owner.action('githubActions:setRepoScope', { ...board, nodeKey: 'gh-repo-1', folders: ['../etc'] })).rejects.toThrow(/Invalid folder/);
    await expect(owner.action('githubActions:setRepoScope', { ...board, nodeKey: 'gh-repo-1', folders: ['nowhere'] })).rejects.toThrow(/No files found/);
    // Clients can't widen the scope by patching the card.
    await owner.mutation('boards:patchNodes', { ...board, changes: [{ id: 'gh-repo-1', patch: { github: { kind: 'repo', scope: [] } } }] });
    expect((await owner.query('boards:read', board)).nodes[0].github.scope).toEqual(['src']);
  });

  it('lets a connected chat read the repository within the card’s folders', async () => {
    const { owner, board, github, connectAndLink, drain } = await setup();
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const linkId = await connectAndLink();
    await owner.action('githubActions:addCard', { ...board, linkId, target: { kind: 'repo' }, key: 'gh-repo-1', x: 0, y: 0 });
    await owner.action('githubActions:setRepoScope', { ...board, nodeKey: 'gh-repo-1', folders: ['src'] });
    let nodes = (await owner.query('boards:read', board)).nodes;
    const context = snapshotNode(nodes[0], nodes);
    await owner.mutation('boards:patchNodes', { ...board, changes: [{ id: 'chat-1', create: { type: 'thread', title: 'Ask', draft: 'What does main export?', x: 600, y: 0, contexts: [context] } }] });
    const requests: any[] = [];
    const outputs: any[][] = [
      [{ type: 'function_call', name: 'github_read_file', call_id: 'read', arguments: JSON.stringify({ repo: 'acme/app', path: 'src/main.ts', start_line: null, end_line: null }) },
       { type: 'function_call', name: 'github_read_file', call_id: 'outside', arguments: JSON.stringify({ repo: 'acme/app', path: 'docs/guide.md', start_line: null, end_line: null }) },
       { type: 'function_call', name: 'github_list_files', call_id: 'list', arguments: JSON.stringify({ repo: 'acme/app', path: 'src' }) }],
      [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'It exports answer = 42 (src/main.ts:1).' }] }],
    ];
    github.routes.openai = (body: any) => {
      requests.push(body);
      if (!body.stream) return new Response(JSON.stringify({ output: [] }));
      return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { output: outputs.shift(), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }) + '\n\n');
    };
    await owner.mutation('chat:send', { ...board, nodeKey: 'chat-1', requestId: 'ask-1', expectedVersion: 0 });
    await drain();
    const streamed = requests.filter(r => r.stream);
    expect(streamed).toHaveLength(2);
    expect(streamed[0].tools.map((tool: any) => tool.name).filter(Boolean)).toEqual(expect.arrayContaining(['github_list_files', 'github_read_file', 'github_search_code']));
    expect(streamed[0].tool_choice).toBe('auto');
    const outputsSent = Object.fromEntries(streamed[1].input.filter((i: any) => i.type === 'function_call_output').map((i: any) => [i.call_id, JSON.parse(i.output)]));
    expect(outputsSent.read).toMatchObject({ repo: 'acme/app', path: 'src/main.ts', content: '1\texport const answer = 42;\n2\t' });
    expect(outputsSent.outside.error).toMatch(/outside this repository card/);
    expect(outputsSent.list.entries.map((e: any) => e.path)).toEqual(['src/main.ts', 'src/lib']);
    nodes = (await owner.query('boards:read', board)).nodes;
    const reply = nodes.find((n: any) => n.id === 'chat-1')!.messages.at(-1);
    expect(reply).toMatchObject({ text: 'It exports answer = 42 (src/main.ts:1).', githubReads: [{ repo: 'acme/app', path: 'src/main.ts' }] });
  });

  it('refuses repository tools once the repository is unlinked or was never connected', async () => {
    const { internal, owner, board, boardId, connectAndLink } = await setup();
    const linkId = await connectAndLink();
    await owner.action('githubActions:addCard', { ...board, linkId, target: { kind: 'repo' }, key: 'gh-repo-1', x: 0, y: 0 });
    const nodes = (await owner.query('boards:read', board)).nodes;
    await owner.mutation('boards:patchNodes', { ...board, changes: [{ id: 'chat-1', create: { type: 'thread', title: 'Ask', draft: 'Hi', x: 600, y: 0, contexts: [snapshotNode(nodes[0], nodes)] } }] });
    const runId = await owner.mutation('chat:send', { ...board, nodeKey: 'chat-1', requestId: 'ask-1', expectedVersion: 0 });
    await internal('chat:claim', { runId }, 'mutation');
    await expect(internal('githubActions:runTool', { runId, name: 'github_read_file', args: { repo: 'acme/other', path: 'x' } })).rejects.toThrow(/isn’t connected to this chat/);
    await owner.mutation('github:unlinkRepo', { boardId, token: '', linkId });
    await expect(internal('githubActions:runTool', { runId, name: 'github_list_files', args: { repo: 'acme/app', path: '' } })).rejects.toThrow(/no longer linked/);
  });
});
