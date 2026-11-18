// MCP clients name themselves in the initialize request (clientInfo.name). The value is
// self-reported and untrusted, so it is only used as a display label.
const known: Array<[RegExp, string]> = [
  [/claude[\s_-]*code/i, 'Claude Code'],
  [/claude/i, 'Claude'],
  [/codex/i, 'Codex'],
  [/chatgpt|openai/i, 'ChatGPT'],
  [/gemini/i, 'Gemini'],
  [/cursor/i, 'Cursor'],
  [/windsurf|codeium/i, 'Windsurf'],
  [/copilot|visual studio code|vs ?code/i, 'VS Code'],
  [/\bzed\b/i, 'Zed'],
  [/goose/i, 'Goose'],
  [/inspector/i, 'MCP Inspector'],
];

/** Keep a client's self-reported name short and plain before storing it. */
export function cleanClientName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[^\p{L}\p{N} ._/-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return cleaned || undefined;
}

/** A friendly label for a stored client name, such as "Claude" or "ChatGPT". */
export function clientLabel(client: string | undefined): string | undefined {
  if (!client) return undefined;
  for (const [pattern, label] of known) if (pattern.test(client)) return label;
  return client.slice(0, 40);
}

/** Reads clientInfo.name from an MCP initialize request body, if it is one. */
export function initializeClient(body: unknown): string | undefined {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (message && typeof message === 'object' && (message as any).method === 'initialize') {
      return cleanClientName((message as any).params?.clientInfo?.name);
    }
  }
  return undefined;
}
