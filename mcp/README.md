# Branch MCP tools

## Connect a board agent

On a board you can edit, open **Agents** and click **Copy setup instructions**. Branch creates a key for this board and copies three steps with the server URL and the private connection key. The key becomes a listed connection the first time an agent uses it. A key that no agent uses within 24 hours expires. Add Branch in a client that accepts a remote Streamable HTTP MCP server with a bearer token, save the key in that client’s private settings, then ask the agent to read the board. The URL is `/api/backend?agent=1` on the same Branch instance.

**Agent settings** holds optional project instructions, the read-only option for the next connection, and controls for disconnecting connections. Setup gives the agent read and contribution access by default. Anyone who can edit the board can create a connection under their own account.

For Codex CLI, set `BRANCH_AGENT_TOKEN` in the environment that launches Codex, then register the server with the URL shown in Branch:

```sh
codex mcp add branch-board --url 'https://joinbranch.dev/api/backend?agent=1' --bearer-token-env-var BRANCH_AGENT_TOKEN
```

Use the URL from **Agents** for local or preview boards. The connection uses a Branch key and does not need macOS Accessibility. Each connection covers one board and can be disconnected from **Agents**. Branch names a connection after the client that first used it, such as Claude, ChatGPT, Codex or Gemini. The client reports this name itself in the MCP handshake. **Agent settings** shows who created each connection and can revoke copied keys that haven’t been used. Saved updates remain in Context after disconnecting.

The copied setup guide, MCP initialization instructions, and every `read_board` response provide the same agent workflow. Agents use this connection to read and change the board, without opening Chrome or using screen control for supported operations. Contribution connections instruct the agent to call `publish_update` before every assistant message, including progress, questions, and final replies. Each message gets a new request ID, reused only for a retry. The update is a concise public summary, with a card link when relevant. Read-only connections explain their access and do not request writes. External clients control their own message lifecycle, so this behavior relies on the agent following the instructions. Reconnect clients that cache MCP initialization instructions to pick up the new workflow immediately.

| Tool | Behavior |
| --- | --- |
| `read_board` | Reads project instructions and the current card list. Follow `nextOffset` for more cards. |
| `read_card` | Reads saved card text and the version used for edits. |
| `read_context` | Reads recent updates and proposals from connected board agents. |
| `publish_update` | Publishes progress in the agent’s Context row, with an optional link to a canvas card. |
| `create_card` | Creates a note on the regular whiteboard. |
| `update_card` | Edits a note created by this connection if its text has not changed since it was read and no teammate is editing it. |
| `propose_edit` | Queues an edit in Context for a board editor to apply or dismiss. |

The four write tools require **Read and contribute**. Use a stable request ID when retrying a create, update to Context, or proposal. For an edit to a card, re-read its text and version after a version conflict. Each call rechecks the person’s board access. Apply [the board agent migration](../supabase/migrations/202611150004_board_agents.sql) and [the connection label migration](../supabase/migrations/202611170001_board_agent_clients.sql) before deploying the feature.

## Local visual planning tools

This local stdio MCP server lets an agent create real shared Branch boards, publish a work plan, maintain step status and findings, and connect evidence/decision notes. Open the returned board URL in Branch to watch changes arrive live. It uses the official MCP SDK; it does not expose an HTTP port or run a second model.

## Setup

1. Install dependencies with `npm ci`. The MCP client uses Branch's permission-checked HTTP API backed by Supabase; no Convex deployment is needed.
2. Use the live app at `https://branch.eshteremberg.workers.dev`, or start a configured local backend with `npm run dev` (http://127.0.0.1:4387).
3. Configure a stdio MCP client with the absolute path to `mcp/server.cjs` and the private environment values below. Use an existing Branch account, or create a dedicated agent account in Branch and share only the boards it needs. Keep credentials in the client's private environment/secret configuration, never a committed file or tool argument.

```json
{
  "mcpServers": {
    "branch": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/board/mcp/server.cjs"],
      "env": {
        "BRANCH_APP_URL": "https://branch.eshteremberg.workers.dev",
        "BRANCH_USERNAME": "YOUR-BRANCH-USERNAME",
        "BRANCH_PASSWORD": "YOUR-BRANCH-PASSWORD"
      }
    }
  }
}
```

Client configuration formats vary; use these command, arguments and environment values in its MCP settings. Launch `node` directly, not npm, to keep stdout exclusively for MCP messages. `npm run mcp` is a manual convenience. The process does not load `.env.local` automatically. Username/password sessions refresh in memory; nothing is persisted to disk. An existing short-lived Supabase account access token can instead be supplied as `BRANCH_AUTH_TOKEN`; reconnect after it expires. This does not use ChatGPT/Codex authentication or require an OpenAI key.

## Agent workflow

Ask: “Use Branch to plan and compare these options. Show your plan first, keep it updated, and build connected findings and a recommendation as you research.”

- `list_boards` finds accessible boards; `create_board` creates a personal board and returns its URL.
- `update_plan` creates a note with a goal and 1–12 concrete steps (`pending`, `working`, `done`, `blocked`). Use a stable `planId` and `expectedVersion: -1` to create. It returns the canvas card ID and version.
- `read_board` provides current cards and versions. Read before updating a plan and supply its current version. Keep the original `planId`, not the returned `plan-` prefixed card ID.
- `add_card` creates a note, website source or draft chat. Reuse a stable `cardId` on retries. `sourceIds` connects it to existing plan/note/website cards using frozen snapshots. Put conclusions, evidence links and uncertainty in notes; use website cards for provenance. A website URL is not proof the page was read. Draft chats do not start model requests.

All operations enforce existing account/board permissions. Plan updates are limited to the creating account's plan cards. Concurrent edits, deleted cards, stale versions and manual plan-body changes are rejected. To preserve a manually edited plan, create a new one with a new ID. Human notes and unrelated cards are never replaced by an MCP board snapshot. Tool errors are redacted so provider errors cannot reveal credentials.

In-app research agents also receive `update_plan`: their first call is a plan, and they can update it and add finding cards during research. These are concise public progress summaries, not hidden model reasoning. The bounded research loop, frozen input, model/provider choice, billing attribution and cancellation checks still apply. A stopped or failed run may leave its last plan step marked working; the agent card is authoritative for run status. External MCP clients determine their own research process and model.

Implementation follows the [MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server). Protocol integration and backend behavior are covered by `app/tests/mcp.test.cjs` and `collaboration/agent.test.ts`.
