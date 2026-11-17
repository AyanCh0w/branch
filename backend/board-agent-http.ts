import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { tokenHash } from './functions/access';
import { BoardAgentError } from './functions/boardAgents';
import type { Engine } from './engine';
import { boardAgentInstructions } from './board-agent-instructions';

export async function boardAgentRequest(request: Request, engine: Engine) {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  if (request.headers.has('origin')) return new Response(null, { status: 403, headers });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST' } });
  const unauthorized = () => new Response(null, { status: 401, headers: { ...headers, 'WWW-Authenticate': 'Bearer' } });
  const code = request.headers.get('authorization')?.match(/^Bearer (branch_agent_[a-f0-9]{64})$/)?.[1];
  if (!code) return unauthorized();
  const keyHash = await tokenHash(code);
  let mode;
  try {
    ({ mode } = await engine.call('boardAgents:checkConnection', { keyHash }, {}, 'query', true));
  } catch (error) {
    if (error instanceof BoardAgentError) return unauthorized();
    throw error;
  }

  const server = new McpServer({ name: 'branch-board', version: '1.0.0' }, {
    instructions: boardAgentInstructions(mode),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 256 * 1024,
  });
  const nodeKey = z.string().min(1).max(160).describe('The card ID returned by read_board or create_card.');
  const requestId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).describe('Reuse this ID only when retrying the same request.');
  const note = { title: z.string().trim().min(1).max(100), body: z.string().max(24_000).describe('Markdown note text.') };
  const edit = { nodeKey, expectedVersion: z.number().int().nonnegative(), ...note };

  function tool(name: string, operation: string, description: string, inputSchema: z.ZodRawShape,
    kind: 'query' | 'mutation', idempotentHint = false) {
    server.registerTool(name, {
      description, inputSchema,
      annotations: { readOnlyHint: kind === 'query', destructiveHint: false, idempotentHint, openWorldHint: false },
    }, async args => {
      try {
        const result = await engine.call('boardAgents:' + operation, { ...args, keyHash }, {}, kind, true);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        const text = error instanceof BoardAgentError ? error.message : 'Branch could not complete this request.';
        return { isError: true, content: [{ type: 'text', text }] };
      }
    });
  }

  tool('read_board', 'readBoard',
    'Start here to read this board’s project instructions, agent workflow, and cards. Follow agentInstructions and use nextOffset to continue.',
    { offset: z.number().int().nonnegative().default(0) }, 'query');
  tool('read_card', 'readCard', 'Read a card’s saved text and current version from this board.', { nodeKey }, 'query');
  tool('read_context', 'readContext', 'Read recent agent progress and decisions published to this board.',
    { limit: z.number().int().min(1).max(30).default(12) }, 'query');
  if (mode === 'edit') {
    tool('publish_update', 'publish',
      'Before every assistant message, automatically publish a concise summary in the board’s Context. Include progress, questions, decisions, and final replies. Use a new requestId per message and reuse it only for a retry. Optionally link a board card.',
      { requestId, title: z.string().trim().min(1).max(120), result: z.string().trim().min(1).max(8_000), nodeKey: nodeKey.optional() },
      'mutation', true);
    tool('create_card', 'createCard', 'Create a visible note card on the whiteboard.', { requestId, ...note }, 'mutation', true);
    tool('update_card', 'updateCard', 'Replace the title and text of a note created by this connection. Read its current version first.',
      edit, 'mutation');
    tool('propose_edit', 'propose',
      'Suggest a replacement title and text for an existing note. A board editor can review and apply it in Context.',
      { requestId, ...edit, summary: z.string().trim().min(1).max(2_000) }, 'mutation', true);
  }

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const responseHeaders = new Headers(response.headers);
    for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value);
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } finally {
    await server.close();
  }
}
