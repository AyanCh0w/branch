import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { tokenHash } from './access';
import { accessSeconds, chatgptClient, chatgptRedirect, frontend, issuer, pkce, resource, syncScope, validRequest } from './chatgptOAuth';

const metadataUrl = () => issuer() + '/.well-known/oauth-protected-resource/chatgpt/mcp';
const noStore = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const oauthError = (error: string) => Response.json({ error }, { status: 400, headers: noStore });
const challengeHeader = () => `Bearer resource_metadata="${metadataUrl()}", scope="${syncScope}", error="invalid_token", error_description="Connect your Branch account to continue"`;
const newSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');

export const protectedResource = httpAction(async () => Response.json({
  resource: resource(), authorization_servers: [issuer()], scopes_supported: [syncScope], bearer_methods_supported: ['header'],
}, { headers: noStore }));

export const authorizationServer = httpAction(async () => Response.json({
  issuer: issuer(), authorization_response_iss_parameter_supported: true,
  authorization_endpoint: issuer() + '/chatgpt/authorize', token_endpoint: issuer() + '/chatgpt/token',
  client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'], response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'], scopes_supported: [syncScope],
}, { headers: noStore }));

export const authorizeChatGPT = httpAction(async (_ctx, request) => {
  const params = new URL(request.url).searchParams;
  const field = (key: string) => params.get(key) || '';
  const input = {
    clientId: field('client_id'), redirectUri: field('redirect_uri'), resource: field('resource'),
    challenge: field('code_challenge'), state: field('state'),
  };
  if (!validRequest(input)) return oauthError('invalid_request');
  if (field('response_type') !== 'code' || field('code_challenge_method') !== 'S256'
    || (field('scope') && field('scope') !== syncScope)) return oauthError('invalid_request');
  const url = new URL('/app', frontend());
  url.hash = new URLSearchParams({ 'chatgpt-connect': '1', ...input }).toString();
  return new Response(null, { status: 302, headers: { ...noStore, Location: url.href } });
});

export const token = httpAction(async (ctx, request) => {
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return oauthError('invalid_request');
  let body = '';
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  if (!reader) return oauthError('invalid_request');
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        return oauthError('invalid_request');
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  const params = new URLSearchParams(body);
  if (new Set(params.keys()).size !== [...params.keys()].length) return oauthError('invalid_request');
  const boundResource = params.get('resource');
  if (params.get('client_id') !== chatgptClient || request.headers.has('authorization')) return oauthError('invalid_client');
  const grantType = params.get('grant_type');
  if (boundResource !== resource() && (boundResource !== null || grantType !== 'refresh_token')) return oauthError('invalid_target');
  const hex = /^[0-9a-f]{64}$/;
  const access = 'bca_' + newSecret();
  const refresh = 'bcr_' + newSecret();
  const fields = { resource: resource(), accessHash: await tokenHash(access), refreshHash: await tokenHash(refresh) };
  try {
    if (grantType === 'authorization_code') {
      const code = params.get('code') || '';
      const verifier = params.get('code_verifier') || '';
      if (!hex.test(code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || params.get('redirect_uri') !== chatgptRedirect) return oauthError('invalid_grant');
      await ctx.runMutation(internal.chatgptOAuth.exchange, {
        ...fields, code: { hash: await tokenHash(code), challenge: await pkce(verifier) },
      });
    } else if (grantType === 'refresh_token') {
      const value = params.get('refresh_token') || '';
      if (!/^bcr_[0-9a-f]{64}$/.test(value)) return oauthError('invalid_grant');
      await ctx.runMutation(internal.chatgptOAuth.exchange, { ...fields, refresh: await tokenHash(value) });
    } else return oauthError('unsupported_grant_type');
  } catch {
    return oauthError('invalid_grant');
  }
  return Response.json({
    access_token: access, refresh_token: refresh, expires_in: accessSeconds, token_type: 'Bearer', scope: syncScope,
  }, { headers: noStore });
});

export const chatgptMcp = httpAction(async (ctx, request) => {
  if (request.headers.has('origin')) return new Response(null, { status: 403, headers: noStore });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...noStore, Allow: 'POST' } });
  const bearer = request.headers.get('authorization')?.match(/^Bearer (bca_[a-f0-9]{64})$/)?.[1];
  const accessHash = bearer ? await tokenHash(bearer) : '';
  const authMeta = { securitySchemes: [{ type: 'oauth2', scopes: [syncScope] }] };
  const text = (value: string) => [{ type: 'text' as const, text: value }];
  const authRequired = () => ({
    isError: true, content: text('Connect your Branch account and choose the board that should receive updates.'),
    _meta: { 'mcp/www_authenticate': [challengeHeader()] },
  });
  const responseData = (value: Record<string, unknown>) => ({ content: text(JSON.stringify(value)), structuredContent: value });
  const server = new McpServer({ name: 'branch-chatgpt', version: '1.0.0' }, {
    instructions: 'When the user asks to sync work to Branch, call sync_branch_update after the work is ready. Use one stable update UUID per turn. If asked to keep syncing this chat, save subsequent completed work in the same card. Send only user-visible work selected for sharing. The connected board can be read by its members. Never save hidden reasoning, secrets, or another chat. If saving fails, tell the user.',
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 128 * 1024,
  });

  server.registerTool('get_profile', {
    title: 'Get Branch account', description: 'Identify the Branch account connected to ChatGPT.',
    inputSchema: {}, outputSchema: { id: z.string().min(1), name: z.string().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false }, _meta: { ...authMeta, 'openai/profile': true },
  }, async () => {
    if (!accessHash) return authRequired();
    try {
      return responseData(await ctx.runQuery(internal.chatgptOAuth.profile, { accessHash }));
    } catch {
      return authRequired();
    }
  });

  server.registerTool('sync_branch_update', {
    title: 'Sync work to Branch',
    description: 'When asked to sync this conversation to Branch, create its card or append one completed, user-visible update to its Shared context view on the connected board. Board members can read the saved update.',
    inputSchema: {
      updateId: z.uuid().describe('A new UUID for each update. Reuse the same UUID and payload when retrying.'),
      title: z.string().trim().min(1).max(120).describe('Short topic shown on the canvas. Used when creating the card.'),
      prompt: z.string().max(4000).optional().describe('Optional user-facing request or context the user asked to share.'),
      result: z.string().trim().min(1).max(12_000).describe('Completed answer or progress summary for people on the connected board.'),
    },
    outputSchema: { boardTitle: z.string(), cardId: z.string(), url: z.url() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { ...authMeta, 'openai/toolInvocation/invoking': 'Saving to Branch', 'openai/toolInvocation/invoked': 'Saved to Branch' },
  }, async (args, { _meta }) => {
    if (!accessHash) return authRequired();
    const session = _meta?.['openai/session'];
    if (typeof session !== 'string' || !session.trim() || session.length > 512) {
      return { isError: true, content: text('Open the Branch plugin in your ChatGPT conversation and try again.') };
    }
    const conversationId = await tokenHash(session);
    try {
      return responseData(await ctx.runMutation(internal.chatgptSync.append, { ...args, accessHash, conversationId }));
    } catch (error) {
      const data = (error as { data?: unknown }).data;
      if (data === 'invalid_grant') return authRequired();
      return { isError: true, content: text(typeof data === 'string' ? data : 'Branch could not save this update.') };
    }
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(await response.text() || null, { status: response.status, headers });
  } finally {
    await server.close();
  }
});
