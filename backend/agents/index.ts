// HTTP endpoints used by other programs rather than the Branch browser app:
// coding agents (MCP), the ChatGPT connector (MCP + OAuth) and GitHub webhooks.
import { createHash } from 'node:crypto';
import { engine, configured, rateLimit } from '../service';
import { internal } from '../references';
import { codingMcp } from './coding';
import { authorizationServer, authorizeChatGPT, chatgptMcp, protectedResource, token } from './chatgpt';

type Handler = (ctx: any, request: Request) => Promise<Response>;
const noStore = { 'Cache-Control': 'no-store' };

async function signed(secret: string, body: Uint8Array, header: string | null) {
  const match = /^sha256=([a-f0-9]{64})$/.exec(header || '');
  if (!match) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, Uint8Array.from(match[1].match(/../g)!, byte => parseInt(byte, 16)), body as BufferSource);
}

// Only the few fields Branch acts on leave this function; the rest of the delivery is discarded.
export function webhookEvent(event: string | null, data: any): { event: 'push' | 'pull_request'; payload: any } | null {
  const repoId = data?.repository?.id;
  if (!Number.isInteger(repoId)) return null;
  if (event === 'pull_request') {
    const pull = data.pull_request, action = data.action;
    const state = action === 'closed' ? (pull?.merged ? 'merged' : 'closed') : action === 'opened' || action === 'reopened' ? 'opened' : null;
    // Branch names from forks are not this repository's branches.
    if (!state || !Number.isInteger(pull?.number) || typeof pull?.head?.ref !== 'string' || pull.head.repo?.id !== repoId) return null;
    return { event, payload: { repoId, branch: pull.head.ref.slice(0, 200), number: pull.number, state, title: String(pull.title || '').slice(0, 300) } };
  }
  if (event === 'push') {
    if (typeof data.ref !== 'string' || !data.ref.startsWith('refs/heads/') || data.deleted) return null;
    const paths = new Set<string>();
    for (const commit of Array.isArray(data.commits) ? data.commits : []) for (const list of [commit.added, commit.modified, commit.removed]) for (const path of Array.isArray(list) ? list : []) if (typeof path === 'string' && paths.size < 300) paths.add(path);
    if (!paths.size) return null;
    return { event, payload: { repoId, branch: data.ref.slice('refs/heads/'.length), paths: [...paths] } };
  }
  return null;
}

async function githubWebhook(ctx: any, request: Request): Promise<Response> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...noStore, Allow: 'POST' } });
  if (!secret) return new Response(null, { status: 404, headers: noStore });
  const body = new Uint8Array(await request.arrayBuffer());
  if (!await signed(secret, body, request.headers.get('x-hub-signature-256'))) return new Response(null, { status: 401, headers: noStore });
  let parsed;
  try { parsed = webhookEvent(request.headers.get('x-github-event'), JSON.parse(new TextDecoder().decode(body))); } catch { return new Response(null, { status: 400, headers: noStore }); }
  if (parsed) await ctx.runMutation(internal.github.receiveWebhook, parsed);
  return new Response(null, { status: 202, headers: noStore });
}

const routes: Record<string, Handler> = {
  '/api/mcp': codingMcp,
  '/api/chatgpt/mcp': chatgptMcp,
  '/api/chatgpt/authorize': authorizeChatGPT,
  '/api/chatgpt/token': token,
  '/api/github/webhook': githubWebhook,
  '/.well-known/oauth-protected-resource': protectedResource,
  '/.well-known/oauth-protected-resource/api/chatgpt/mcp': protectedResource,
  '/.well-known/oauth-authorization-server': authorizationServer,
};
export const agentPaths = Object.keys(routes);
// GitHub deliveries are the largest body; MCP requests are capped again by their transport.
const MAX_BODY = 5 * 1024 * 1024;

// Bridges the Node request the app server receives to the web-standard handlers above.
export async function agentRoute(req: any, res: any, url: URL) {
  const send = (status: number, headers: Record<string, string> = {}) => { res.writeHead(status, { ...noStore, ...headers }); res.end(); };
  const handler = routes[url.pathname];
  if (!handler) return send(404);
  if (!configured()) return send(503);
  try {
    const ip = process.env.CLOUDFLARE_WORKER === 'true' ? String(req.headers['cf-connecting-ip'] || 'unknown') : process.env.VERCEL ? String(req.headers['x-forwarded-for'] || '').split(',')[0] : req.socket?.remoteAddress || 'local';
    try { await rateLimit('agent:' + createHash('sha256').update(ip).digest('hex'), 600, 60); } catch { return send(429, { 'Retry-After': '60' }); }
    const chunks: Buffer[] = [];
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.body !== undefined) chunks.push(Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body)));
      else { let size = 0; for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) return send(413); chunks.push(chunk); } }
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value); else if (Array.isArray(value)) headers.set(key, value.join(', '));
    const request = new Request(url.href, { method: req.method, headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const response = await handler(engine.context(null, {}), request);
    const out: Record<string, string> = {};
    response.headers.forEach((value, key) => { out[key] = value; });
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    // Never return database errors, credentials, or stack traces.
    if (!res.headersSent) send(500); else res.end();
  }
}
