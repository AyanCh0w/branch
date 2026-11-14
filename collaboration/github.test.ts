import { convexTest } from 'convex-test';
import { it, expect, vi, afterEach, describe } from 'vitest';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { registerCore, sessionIdentity } from '@convex-dev/auth/test';
import { registerPassword } from '@convex-dev/auth/components/password/test';
import { registerUsername } from '@convex-dev/auth/components/username/test';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
import { appJWT, fileCard } from './github.cjs';
import { textOf } from '../app/context.js';

const modules = import.meta.glob('../convex/**/*.ts');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs1', format: 'pem' } });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

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
    ...overrides,
  };
  const stub = vi.fn(async (input: string, init: any = {}) => {
    const method = init.method || 'GET', url = input.replace('https://api.github.com', '');
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url, body, auth: init.headers?.Authorization || '' });
    const route = routes[method + ' ' + url];
    if (route === undefined) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    const value = typeof route === 'function' ? route(body) : route;
    return route === null ? new Response(null, { status: 204 }) : new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', stub);
  return { calls, routes };
}

async function setup() {
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://test.convex.cloud');
  for (const [k, value] of Object.entries({ GITHUB_CLIENT_ID: 'Iv-client', GITHUB_CLIENT_SECRET: 'secret', GITHUB_PRIVATE_KEY: privateKey, GITHUB_APP_SLUG: 'branch-app' })) vi.stubEnv(k, value);
  const t = convexTest(schema, modules); registerCore(t); registerPassword(t); registerUsername(t);
  const account = async (username: string) => {
    const result = await t.mutation(api.auth.signUpWithUsernamePassword, { username, password: 'test-specific-unique-password-94821' });
    if (result.status !== 'complete') throw Error(JSON.stringify(result));
    return t.withIdentity(sessionIdentity(result.tokens));
  };
  const owner = await account('owner'), other = await account('other');
  const boardId = await owner.mutation(api.library.create, { title: 'Project' });
  const board = { boardId, token: '' };
  const github = fakeGitHub();
  const connectAndLink = async () => {
    await owner.action(api.githubActions.connect, { code: 'good-code', redirectUri: 'http://127.0.0.1:4387/app' });
    return owner.mutation(api.github.linkRepo, { boardId, repoId: REPO.id });
  };
  return { t, owner, other, boardId, board, github, connectAndLink };
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
    const { t } = await setup();
    expect(await t.query(api.github.config, {})).toEqual({ enabled: true, clientId: 'Iv-client', installURL: 'https://github.com/apps/branch-app/installations/new' });
    vi.stubEnv('GITHUB_PRIVATE_KEY', '');
    expect(await t.query(api.github.config, {})).toEqual({ enabled: false });
  });

  it('verifies repositories with a one-time user token, then revokes it', async () => {
    const { t, owner, github } = await setup();
    await expect(t.action(api.githubActions.connect, { code: 'good-code', redirectUri: 'x' })).rejects.toThrow(/Sign in/);
    await expect(owner.action(api.githubActions.connect, { code: 'stale', redirectUri: 'x' })).rejects.toThrow(/expired/);
    expect(await owner.action(api.githubActions.connect, { code: 'good-code', redirectUri: 'http://127.0.0.1:4387/app' })).toEqual({ login: 'octo', repositories: 1 });
    const connection = await owner.query(api.github.connection, {});
    expect(connection).toMatchObject({ connected: true, login: 'octo', repos: [{ id: 101, fullName: 'acme/app', private: true, defaultBranch: 'main' }] });
    expect(JSON.stringify(connection)).not.toContain('installation');
    const revoke = github.calls.find(c => c.method === 'DELETE');
    expect(revoke).toMatchObject({ url: '/applications/Iv-client/token', body: { access_token: 'user-token' } });
    expect(revoke!.auth).toMatch(/^Basic /);
    expect(JSON.stringify(await t.run(ctx => ctx.db.query('githubConnections').collect()))).not.toContain('user-token');
  });

  it('only links repositories the person verified, and only for editors', async () => {
    const { owner, other, boardId, connectAndLink } = await setup();
    await expect(owner.mutation(api.github.linkRepo, { boardId, repoId: REPO.id })).rejects.toThrow(/Connect GitHub/);
    const linkId = await connectAndLink();
    expect(await owner.mutation(api.github.linkRepo, { boardId, repoId: REPO.id })).toBe(linkId);
    await expect(owner.mutation(api.github.linkRepo, { boardId, repoId: OTHER.id })).rejects.toThrow(/Connect GitHub/);
    await expect(other.mutation(api.github.linkRepo, { boardId, repoId: REPO.id })).rejects.toThrow(/denied/);
    await owner.mutation(api.sharing.addMember, { boardId, username: 'other', role: 'viewer' });
    expect(await other.query(api.github.boardRepos, { boardId, token: '' })).toMatchObject([{ fullName: 'acme/app', canRemove: false }]);
    await expect(other.action(api.githubActions.browse, { boardId, token: '', linkId, path: '' })).rejects.toThrow(/denied/);
  });

  it('drops board links when access shrinks or GitHub is disconnected', async () => {
    const { owner, boardId, github, connectAndLink } = await setup();
    await connectAndLink();
    github.routes['GET /user/installations/55/repositories?per_page=100&page=1'] = { repositories: [OTHER] };
    await owner.action(api.githubActions.connect, { code: 'good-code', redirectUri: 'x' });
    expect(await owner.query(api.github.boardRepos, { boardId, token: '' })).toEqual([]);
    await owner.mutation(api.github.linkRepo, { boardId, repoId: OTHER.id });
    await owner.mutation(api.github.disconnect, {});
    expect(await owner.query(api.github.boardRepos, { boardId, token: '' })).toEqual([]);
    expect(await owner.query(api.github.connection, {})).toEqual({ connected: false });
  });
});

describe('GitHub cards', () => {
  it('browses with an installation token scoped to the one repository', async () => {
    const { owner, board, github, connectAndLink } = await setup();
    const linkId = await connectAndLink();
    expect(await owner.action(api.githubActions.browse, { ...board, linkId, path: '' })).toEqual([{ type: 'dir', name: 'src', path: 'src', size: 0 }, { type: 'file', name: 'README.md', path: 'README.md', size: 20 }]);
    const mint = github.calls.filter(c => c.url === '/app/installations/55/access_tokens').at(-1)!;
    expect(mint.body).toEqual({ repository_ids: [101], permissions: { contents: 'read', issues: 'read', pull_requests: 'read', metadata: 'read' } });
    expect(mint.auth).toMatch(/^Bearer ey/);
    expect(github.calls.at(-1)!.auth).toBe('Bearer installation-token');
    expect(await owner.action(api.githubActions.items, { ...board, linkId, kind: 'issue', search: '' })).toEqual([{ number: 3, title: 'Login breaks', state: 'open', author: 'amy', updatedAt: 'now' }]);
  });

  it('adds file, issue and pull request cards that feed chat context', async () => {
    const { owner, board, connectAndLink } = await setup();
    const linkId = await connectAndLink();
    await owner.action(api.githubActions.addCard, { ...board, linkId, target: { kind: 'file', path: 'src/main.ts' }, key: 'gh-file-1', x: 10, y: 20 });
    await owner.action(api.githubActions.addCard, { ...board, linkId, target: { kind: 'issue', number: 3 }, key: 'gh-issue-1', x: 0, y: 0 });
    await owner.action(api.githubActions.addCard, { ...board, linkId, target: { kind: 'pull', number: 9 }, key: 'gh-pull-1', x: 0, y: 0 });
    const nodes = (await owner.query(api.boards.read, board)).nodes;
    const file = nodes.find((n: any) => n.id === 'gh-file-1')!, issue = nodes.find((n: any) => n.id === 'gh-issue-1')!, pull = nodes.find((n: any) => n.id === 'gh-pull-1')!;
    expect(file).toMatchObject({ type: 'github', title: 'src/main.ts', x: 10, y: 20, text: 'export const answer = 42;\n', github: { kind: 'file', repo: 'acme/app', ref: 'main', language: 'typescript' } });
    expect(textOf(file)).toContain('GitHub file acme/app/src/main.ts (branch main)');
    expect(textOf(file)).toContain('```typescript\nexport const answer = 42;');
    expect(issue).toMatchObject({ title: '#3 Login breaks', github: { kind: 'issue', state: 'open', author: 'amy', labels: ['bug'] } });
    expect(issue.text).toContain('@bo commented:\nConfirmed on Safari');
    expect(textOf(issue)).toContain('GitHub issue acme/app#3 (open, opened by @amy)');
    expect(pull).toMatchObject({ title: '#9 Fix login', github: { kind: 'pull', head: 'fix-login', base: 'main', additions: 3 } });
    expect(pull.text).toContain('#### src/login.ts (modified, +3 −1)\n```diff');
    await expect(owner.action(api.githubActions.addCard, { ...board, linkId, target: { kind: 'issue', number: 4 }, key: 'gh-x', x: 0, y: 0 })).rejects.toThrow();
    await expect(owner.action(api.githubActions.addCard, { ...board, linkId, target: { kind: 'file', path: 'logo.png' }, key: 'gh-png', x: 0, y: 0 })).rejects.toThrow(/binary/);
  });

  it('keeps card content server-authored and refreshes it with a new revision', async () => {
    const { owner, board, github, connectAndLink } = await setup();
    const linkId = await connectAndLink();
    await owner.action(api.githubActions.addCard, { ...board, linkId, target: { kind: 'file', path: 'src/main.ts' }, key: 'gh-file-1', x: 0, y: 0 });
    await owner.mutation(api.boards.patchNodes, { ...board, changes: [{ id: 'gh-file-1', patch: { text: 'forged', x: 99 } }] });
    let card = (await owner.query(api.boards.read, board)).nodes[0];
    expect(card).toMatchObject({ text: 'export const answer = 42;\n', x: 99, revision: 1 });
    await expect(owner.mutation(api.boards.patchNodes, { ...board, changes: [{ id: 'gh-new', create: { type: 'github', text: 'forged' } }] })).rejects.toThrow(/Invalid node type/);
    expect(await owner.action(api.githubActions.refreshCard, { ...board, nodeKey: 'gh-file-1' })).toEqual({ changed: false });
    github.routes['GET /repos/acme/app/contents/src/main.ts?ref=main'] = { ...github.routes['GET /repos/acme/app/contents/src/main.ts?ref=main'], sha: 'new', content: b64('export const answer = 43;\n') };
    expect(await owner.action(api.githubActions.refreshCard, { ...board, nodeKey: 'gh-file-1' })).toEqual({ changed: true });
    card = (await owner.query(api.boards.read, board)).nodes[0];
    expect(card).toMatchObject({ text: 'export const answer = 43;\n', revision: 2, github: { sha: 'new' } });
  });

  it('stops reading once the repository is unlinked', async () => {
    const { owner, board, boardId, connectAndLink } = await setup();
    const linkId = await connectAndLink();
    await owner.action(api.githubActions.addCard, { ...board, linkId, target: { kind: 'issue', number: 3 }, key: 'gh-issue-1', x: 0, y: 0 });
    await owner.mutation(api.github.unlinkRepo, { boardId, token: '', linkId });
    await expect(owner.action(api.githubActions.browse, { ...board, linkId, path: '' })).rejects.toThrow(/no longer linked/);
    await expect(owner.action(api.githubActions.refreshCard, { ...board, nodeKey: 'gh-issue-1' })).rejects.toThrow(/Link acme\/app/);
  });
});

it('truncates very large files and rejects folders', () => {
  const big = { type: 'file', path: 'big.txt', size: 200000, sha: 's', html_url: 'u', content: b64('x'.repeat(150000)) };
  expect(fileCard('a/b', big, 'main')).toMatchObject({ github: { truncated: true } });
  expect(fileCard('a/b', big, 'main').text).toHaveLength(100000);
  expect(() => fileCard('a/b', { type: 'dir' }, 'main')).toThrow(/folder/);
});
