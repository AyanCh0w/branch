import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { registerCore, sessionIdentity } from '@convex-dev/auth/test';
import { registerPassword } from '@convex-dev/auth/components/password/test';
import { registerUsername } from '@convex-dev/auth/components/username/test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import { tokenHash } from '../convex/access';
import { chatgptClient, chatgptRedirect, pkce, grantMaxMs, refreshGraceMs } from '../convex/chatgptOAuth';
import { BURST } from '../convex/chatgptSync';

const modules = import.meta.glob('../convex/**/*.ts');
const issuer = 'https://test.convex.site';
const resource = issuer + '/chatgpt/mcp';
const verifier = 'v'.repeat(64);
const code = 'c'.repeat(64);
const first = { updateId: '2779ed4c-ee63-4880-83cb-077c08a7e3f5', title: 'Check-in notes', prompt: 'Draft the plan', result: 'First update' };
const second = { ...first, updateId: '2e9d4c89-5278-4f7b-b411-db99618c0b6e', result: 'Second update' };

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function setup() {
  vi.stubEnv('CONVEX_SITE_URL', issuer);
  vi.stubEnv('BRANCH_CONNECTOR_URL', issuer);
  vi.stubEnv('CONVEX_CLOUD_URL', 'https://test.convex.cloud');
  vi.stubEnv('BRANCH_APP_URL', 'https://branch.example');
  const t = convexTest(schema, modules);
  registerCore(t);
  registerPassword(t);
  registerUsername(t);
  const account = async (username: string) => {
    const signup = await t.mutation(api.auth.signUpWithUsernamePassword, { username, password: 'test-password-78-foo' });
    if (signup.status !== 'complete') throw Error('Could not create the test account');
    return t.withIdentity(sessionIdentity(signup.tokens));
  };
  const owner = await account('owner');
  const guest = await account('viewer');
  const boardId = await owner.mutation(api.library.create, { title: 'Target board' });
  const secondBoard = await owner.mutation(api.library.create, { title: 'Separate board' });
  const editor = await account('editor');
  await owner.mutation(api.sharing.addMember, { boardId, username: 'viewer', role: 'viewer' });
  await owner.mutation(api.sharing.addMember, { boardId, username: 'editor', role: 'editor' });
  const request = { clientId: chatgptClient, redirectUri: chatgptRedirect, resource, challenge: await pkce(verifier), state: 'test-state' };
  const consent = async (actor = owner, changes = {}) =>
    actor.mutation(api.chatgptOAuth.authorize, { ...request, boardId, codeHash: await tokenHash(code), ...changes });
  const exchange = (changes: Record<string, string> = {}) => t.fetch('/chatgpt/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: chatgptClient, grant_type: 'authorization_code', code,
      code_verifier: verifier, redirect_uri: chatgptRedirect, resource, ...changes }).toString(),
  });
  const rpc = async (method: string, params: object = {}, accessToken?: string) => {
    const response = await t.fetch('/chatgpt/mcp', {
      method: 'POST', headers: {
        accept: 'application/json, text/event-stream', 'content-type': 'application/json',
        ...(accessToken ? { authorization: 'Bearer ' + accessToken } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    expect(response.status).toBe(200);
    return (await response.json()).result;
  };
  const sync = (value = first, token?: string, session = 'stable-openai-session') => rpc('tools/call', {
    name: 'sync_branch_update', arguments: value, _meta: { 'openai/session': session },
  }, token);
  return { t, owner, guest, editor, request, consent, exchange, rpc, sync, boardId, secondBoard };
}

it('discovers OAuth, binds consent to the selected board and rejects invalid exchanges', async () => {
  const { t, guest, request, consent, exchange, rpc, sync } = await setup();
  const metadata = await t.fetch('/.well-known/oauth-protected-resource/chatgpt/mcp');
  expect(await metadata.json()).toMatchObject({ resource, authorization_servers: [issuer] });
  const url = '/chatgpt/authorize?' + new URLSearchParams({
    client_id: request.clientId, redirect_uri: request.redirectUri, resource, code_challenge: request.challenge,
    state: request.state, response_type: 'code', code_challenge_method: 'S256', scope: 'branch:sync',
  });
  const authorize = await t.fetch(url);
  expect(authorize.status).toBe(302);
  expect(authorize.headers.get('location')).toContain('https://branch.example/app#chatgpt-connect=1');
  const tools = (await rpc('tools/list')).tools;
  expect(tools[1]._meta.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['branch:sync'] }]);
  expect((await sync())._meta['mcp/www_authenticate'][0]).toContain('error_description');
  await expect(consent(guest)).rejects.toThrow('Board access denied');
  await expect(consent(undefined, { redirectUri: 'https://example.com' })).rejects.toThrow('Invalid ChatGPT connection');
  await consent();
  expect((await exchange({ code_verifier: 'x'.repeat(64) })).status).toBe(400);
  expect((await exchange({ resource: issuer + '/mcp' })).status).toBe(400);
  const response = await exchange();
  expect(response.status).toBe(200);
  expect((await exchange()).status).toBe(400);
});

it('adds one card per conversation and leaves its transcript out of board snapshots', async () => {
  const { t, owner, guest, consent, exchange, sync, boardId, secondBoard } = await setup();
  await consent();
  const tokens = await (await exchange()).json();
  const created = await sync(first, tokens.access_token);
  expect(created.isError).not.toBe(true);
  const nodeKey = created.structuredContent.cardId;
  expect(created.structuredContent.url).toBe('https://branch.example/app?board=' + boardId + '&context=' + nodeKey);
  await Promise.all([sync(second, tokens.access_token), sync(second, tokens.access_token)]);
  const { nodes } = await owner.query(api.boards.read, { boardId, token: '' });
  expect(nodes).toHaveLength(1);
  expect(nodes[0]).toMatchObject({ id: nodeKey, title: 'Check-in notes', body: '', chatgptSynced: true });
  expect(JSON.stringify(nodes)).not.toContain('First update');
  const args = { boardId, token: '', nodeKey, paginationOpts: { numItems: 10, cursor: null } };
  const timeline = await guest.query(api.chatgptSync.read, args);
  expect(timeline.page.map(row => row.result)).toEqual(['Second update', 'First update']);
  await expect(t.query(api.chatgptSync.read, args)).rejects.toThrow();
  expect((await owner.query(api.boards.read, { boardId: secondBoard, token: '' })).nodes).toEqual([]);

  const separate = await sync(first, tokens.access_token, 'another-openai-session');
  expect(separate.structuredContent.cardId).not.toBe(nodeKey);
  await owner.mutation(api.boards.deleteNode, { boardId, nodeKey, token: '', operationId: 'delete' });
  expect((await sync(second, tokens.access_token)).isError).toBe(true);
});

it('rechecks editor access, rotates refresh tokens, and stops after disconnect', async () => {
  const { owner, editor, consent, exchange, sync, boardId } = await setup();
  await consent(editor);
  const started = await (await exchange()).json();
  const refresh = { grant_type: 'refresh_token', refresh_token: started.refresh_token };
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  await (await exchange(refresh)).json();
  // A retry with the just-replaced token (for example after a lost response) still works briefly.
  const renewed = await (await exchange(refresh)).json();
  expect(renewed.refresh_token).toBeTruthy();
  clock.mockReturnValue(now + refreshGraceMs + 1);
  expect((await exchange(refresh)).status).toBe(400);
  clock.mockRestore();
  expect((await sync(first, started.access_token)).isError).toBe(true);
  expect((await sync(first, renewed.access_token)).isError).not.toBe(true);
  const { members } = await owner.query(api.sharing.settings, { boardId });
  await owner.mutation(api.sharing.changeMemberRole, { memberId: members.find(member => member.role === 'editor')!.id, role: 'viewer' });
  expect((await sync(second, renewed.access_token)).isError).toBe(true);
  await editor.mutation(api.chatgptOAuth.disconnect, { boardId });
  expect((await exchange({ grant_type: 'refresh_token', refresh_token: renewed.refresh_token })).status).toBe(400);
});

it('keeps simultaneous updates from two connected collaborators on separate branches', async () => {
  const { owner, editor, consent, exchange, sync, boardId } = await setup();
  await consent(owner);
  const firstConnection = await (await exchange()).json();
  await consent(editor);
  const otherConnection = await (await exchange()).json();

  // Even when the same external conversation and retry IDs arrive, each
  // connection writes its own card and thread within the shared board.
  const [one, two] = await Promise.all([
    sync(first, firstConnection.access_token),
    sync({ ...first, title: 'Editor notes', result: 'Editor update' }, otherConnection.access_token),
  ]);
  expect(one.isError).not.toBe(true);
  expect(two.isError).not.toBe(true);
  expect(one.structuredContent.cardId).not.toBe(two.structuredContent.cardId);

  const { nodes } = await owner.query(api.boards.read, { boardId, token: '' });
  expect(nodes).toHaveLength(2);
  expect(nodes.every(node => node.chatgptSynced && node.chatgptLatestUpdate > 0)).toBe(true);
  const read = (nodeKey: string) => owner.query(api.chatgptSync.read, {
    boardId, token: '', nodeKey, paginationOpts: { numItems: 10, cursor: null },
  });
  expect((await read(one.structuredContent.cardId)).page.map(item => item.result)).toEqual(['First update']);
  expect((await read(two.structuredContent.cardId)).page.map(item => item.result)).toEqual(['Editor update']);
});

it('caps a ChatGPT grant at 90 days and keeps one grant per person', async () => {
  const { editor, consent, exchange, boardId, secondBoard, owner } = await setup();
  await owner.mutation(api.sharing.addMember, { boardId: secondBoard, username: 'editor', role: 'editor' });
  await consent(editor);
  const firstTokens = await (await exchange()).json();
  await consent(editor, { boardId: secondBoard });
  await (await exchange()).json();
  // Re-pointing ChatGPT to another board replaces the earlier grant.
  expect((await editor.query(api.chatgptOAuth.connection, { boardId })).connected).toBe(false);
  expect((await editor.query(api.chatgptOAuth.connection, { boardId: secondBoard })).connected).toBe(true);
  expect((await exchange({ grant_type: 'refresh_token', refresh_token: firstTokens.refresh_token })).status).toBe(400);

  // Approve again, then keep refreshing every 25 days: rotation never extends past 90 days from approval.
  await consent(editor, { boardId: secondBoard });
  let refreshToken = (await (await exchange()).json()).refresh_token as string;
  const start = Date.now();
  for (const days of [25, 50, 75]) {
    vi.spyOn(Date, 'now').mockReturnValue(start + days * 86400_000);
    const next = await exchange({ grant_type: 'refresh_token', refresh_token: refreshToken });
    expect(next.status).toBe(200);
    refreshToken = (await next.json()).refresh_token;
  }
  vi.spyOn(Date, 'now').mockReturnValue(start + grantMaxMs + 1);
  expect((await exchange({ grant_type: 'refresh_token', refresh_token: refreshToken })).status).toBe(400);
});

it('recreates a ChatGPT card that was removed without undo, and limits bursts', async () => {
  const { owner, consent, exchange, sync, boardId } = await setup();
  await consent();
  const tokens = await (await exchange()).json();
  const created = await sync(first, tokens.access_token);
  const nodeKey = created.structuredContent.cardId;
  await owner.mutation(api.boards.patchNodes, { boardId, token: '', changes: [{ id: nodeKey, remove: true }] });
  const again = await sync(second, tokens.access_token);
  expect(again.isError).not.toBe(true);
  const replacement = again.structuredContent.cardId;
  expect(replacement).not.toBe(nodeKey);
  const timeline = await owner.query(api.chatgptSync.read, { boardId, token: '', nodeKey: replacement, paginationOpts: { numItems: 10, cursor: null } });
  expect(timeline.page.map(row => row.result)).toEqual(['Second update', 'First update']);

  for (let i = 0; i < BURST - 2; i++) expect((await sync({ ...first, updateId: crypto.randomUUID(), result: 'Burst ' + i }, tokens.access_token)).isError).not.toBe(true);
  const limited = await sync({ ...first, updateId: crypto.randomUUID(), result: 'One too many' }, tokens.access_token);
  expect(limited.isError).toBe(true);
  expect(JSON.stringify(limited)).toContain('Too many updates');
});

it('drops agent connections when access ends and cleans up expired rows', async () => {
  const { t, owner, editor, consent, exchange, boardId } = await setup();
  await consent(editor);
  const tokens = await (await exchange()).json();
  await editor.mutation(api.coding.configure, { boardId, token: '', keyHash: await tokenHash('branch_' + 'd'.repeat(64)) });
  const count = async () => t.run(async ctx => ({ grants: (await ctx.db.query('chatgptGrants').collect()).length, coding: (await ctx.db.query('codingConnections').collect()).length }));
  expect(await count()).toEqual({ grants: 1, coding: 1 });
  const { members } = await owner.query(api.sharing.settings, { boardId });
  await owner.mutation(api.sharing.removeMember, { memberId: members.find(member => member.role === 'editor')!.id });
  expect(await count()).toEqual({ grants: 0, coding: 0 });
  // Re-adding the person doesn't revive the old refresh token.
  await owner.mutation(api.sharing.addMember, { boardId, username: 'editor', role: 'editor' });
  expect((await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).status).toBe(400);

  await consent(owner);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60_000);
  await t.mutation(internal.maintenance.cleanup, {});
  expect(await t.run(async ctx => (await ctx.db.query('chatgptCodes').collect()).length)).toBe(0);
});
