# Branch visual planning MCP

This local stdio MCP server lets an agent create real shared Branch boards, publish a work plan, maintain step status and findings, and connect evidence/decision notes. Open the returned board URL in Branch to watch changes arrive live. It uses the official MCP SDK; it does not expose an HTTP port or run a second model.

## Setup

1. Install dependencies with `npm install` and deploy the updated Convex backend to your development project with `npx convex dev --once`.
2. Start Branch with `node app/server.cjs` (http://127.0.0.1:4387).
3. Configure a stdio MCP client with the absolute path to `mcp/server.cjs` and the private environment values below. Use an existing Branch account, or create a dedicated agent account in Branch and share only the boards it needs. Keep credentials in the client's private environment/secret configuration, never a committed file or tool argument.

```json
{
  "mcpServers": {
    "branch": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/board/mcp/server.cjs"],
      "env": {
        "BRANCH_CONVEX_URL": "https://YOUR-DEPLOYMENT.convex.cloud",
        "BRANCH_APP_URL": "http://127.0.0.1:4387",
        "BRANCH_USERNAME": "YOUR-BRANCH-USERNAME",
        "BRANCH_PASSWORD": "YOUR-BRANCH-PASSWORD"
      }
    }
  }
}
```

Client configuration formats vary; use these command, arguments and environment values in its MCP settings. Launch `node` directly, not npm, to keep stdout exclusively for MCP messages. `npm run mcp` is a manual convenience. The process does not load `.env.local` automatically. Username/password sessions refresh in memory; nothing is persisted to disk. An existing short-lived Convex account access token can instead be supplied as `BRANCH_AUTH_TOKEN`; reconnect after it expires. This does not use ChatGPT/Codex authentication or require an OpenAI key.

## Agent workflow

Ask: “Use Branch to plan and compare these options. Show your plan first, keep it updated, and build connected findings and a recommendation as you research.”

- `list_boards` finds accessible boards; `create_board` creates a personal board and returns its URL.
- `update_plan` creates a note with a goal and 1–12 concrete steps (`pending`, `working`, `done`, `blocked`). Use a stable `planId` and `expectedVersion: -1` to create. It returns the canvas card ID and version.
- `read_board` provides current cards and versions. Read before updating a plan and supply its current version. Keep the original `planId`, not the returned `plan-` prefixed card ID.
- `add_card` creates a note, website source or draft chat. Reuse a stable `cardId` on retries. `sourceIds` connects it to existing plan/note/website cards using frozen snapshots. Put conclusions, evidence links and uncertainty in notes; use website cards for provenance. A website URL is not proof the page was read. Draft chats do not start model requests.

All operations enforce existing account/board permissions. Plan updates are limited to the creating account's plan cards. Concurrent edits, deleted cards, stale versions and manual plan-body changes are rejected. To preserve a manually edited plan, create a new one with a new ID. Human notes and unrelated cards are never replaced by an MCP board snapshot. Tool errors are redacted so provider errors cannot reveal credentials.

In-app research agents also receive `update_plan`: their first call is a plan, and they can update it and add finding cards during research. These are concise public progress summaries, not hidden model reasoning. The bounded research loop, frozen input, model/provider choice, billing attribution and cancellation checks still apply. A stopped or failed run may leave its last plan step marked working; the agent card is authoritative for run status. External MCP clients determine their own research process and model.

Implementation follows the [MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server). Protocol integration and backend behavior are covered by `app/tests/mcp.test.cjs` and `collaboration/agent.test.ts`.
