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
| `get_brief` | The agent’s starting point: project instructions, the plan with step ids and version, decisions, open questions, risks, findings and sources. |
| `update_plan` | Creates or replaces the board’s plan: a goal and 1–12 steps with a status and a one-line note. Rejects a stale version. |
| `add_card` | Adds one short finding, question, risk or note beside its plan step, with its sources. |
| `record_decision` | Adds a decision card and applies the plan-step changes it causes in one call. |
| `add_source` | Adds a website, YouTube video or text file as its own card. |
| `read_board` | Reads project instructions and the current card list. Follow `nextOffset` for more cards. |
| `read_card` | Reads saved card text and the version used for edits. |
| `read_context` | Reads recent updates and proposals from connected board agents. |
| `publish_update` | Publishes progress in the agent’s Context row, with an optional link to a canvas card. |
| `create_card` | Creates a note on the regular whiteboard. |
| `update_card` | Edits a note created by this connection if its text has not changed since it was read and no teammate is editing it. |
| `propose_edit` | Queues an edit in Context for a board editor to apply or dismiss. |

The write tools require **Read and contribute**. Use a stable request ID when retrying a create, update to Context, or proposal. For an edit to a card, re-read its text and version after a version conflict. Each call rechecks the person’s board access. Apply [the board agent migration](../supabase/migrations/202611150004_board_agents.sql) and [the connection label migration](../supabase/migrations/202611170001_board_agent_clients.sql) before deploying the feature.

## Local visual planning tools

This local stdio MCP server lets an agent create real shared Branch boards, publish a plan, keep step statuses current, and record findings, decisions and their sources as short cards. Open the returned board URL in Branch to watch changes arrive live. It uses the official MCP SDK; it does not expose an HTTP port or run a second model.

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

Ask: “Use Branch to plan this. Publish the plan first, keep it updated, and record what you find and decide as you go.”

- `list_boards` finds accessible boards; `create_board` creates a personal board and returns its URL.
- `get_brief` returns the project instructions, the plan with step ids and its version, decisions, open questions, risks, findings and sources. Agents start here and read it again before a decision that affects teammates.
- `update_plan` creates or replaces the plan: one goal and 1–12 steps, each with a title, a status (`pending`, `working`, `done`, `blocked`) and an optional one-line note. `expectedVersion: -1` creates; otherwise send the version from `get_brief`. Without a `planId` it works on the board’s current plan.
- `add_card` adds one finding, question, risk or note next to a plan step. `record_decision` adds a decision and applies its `planChanges` to the shared plan. Reuse a stable `cardId` on retries.
- `add_source`, or `sources` on a card, turns a link into a website card, a YouTube link into a video card and a text file into a file card, placed beside the card it supports. A website URL is not proof the page was read.
- `read_board` and `read_card` read other cards; `read_context` reads the Context timeline; `add_chat_draft` leaves a draft chat that never starts a model request.

## How the board stays readable

The same rules apply to the local server and to connected board agents. The server enforces them; an agent that breaks one gets a refusal saying what to change.

- **Separate cards, arranged together.** The plan, each step and each item is its own card on the open board. The plan sits on top, steps in a row beneath it, and each step's cards in a column under the step, joined only by short connectors. Agents never choose positions. Each browser places the unmoved cards from their real sizes, so they cannot overlap, and opening a card moves its neighbours along. A card someone drags stays where they put it; a moved step brings its column with it.
- **Follow one part, or see the outline.** **Follow** on a step dims everything else and brings that step's column into view. **Outline** on the plan shows only the plan and its steps.
- **No limits on how much a project holds.** A plan has as many steps as the work has, in one row, and a step has as many cards as it needs. Finished steps fold their findings away but keep open questions and risks in sight; answered questions and replaced findings fold behind "closed". Anyone can fold or unfold a step.
- **Every card has a home.** A card belongs to one step or sits under Unsorted. A step that holds cards cannot be dropped from `update_plan`: the agent maps it to another step or archives it with `moves`.
- **Short cards, full reasoning in Context.** What is limited is the length of text on a card, not the number of cards. Long explanations go in `detail` or `log_research`, which are saved to Context.
- **One card per topic.** A second card on a subject already under the step is refused with the id of the card to change; `revise_card` keeps the earlier versions and who wrote them. `replaces` closes the card a new one answers or supersedes.
- **Sources are chips on their card:** a website, a YouTube video or a text file. A person can open any chip as its own card.
- **Anyone can edit, and every edit is attributed.** People edit cards and step statuses on the board; agents use `revise_card` and `update_plan`. Card versions and plan changes are listed with who made them. A stale plan version or card revision is refused.
- **Organize.** The board checks itself against these rules and shows "Needs organizing" when one is broken. **Organize** previews what it will do, then re-homes stray cards, turns separate source cards into chips and returns pulled-out cards. It never changes text and can be undone. It also converts a plan made in the earlier free-floating layout.

Calls from older copies of this server still work: their notes are shortened to the first sentence with the full text under Reasoning and in Context.

To see a board without an account or a database:

```sh
npm run demo:plan-board   # then open http://127.0.0.1:4399
```

All operations enforce existing account/board permissions. Concurrent edits, deleted cards and stale versions are rejected. Human notes and unrelated cards are never replaced by an MCP board snapshot. Tool errors are redacted so provider errors cannot reveal credentials; only the backend’s own “fix and retry” guidance is passed through.

In-app research agents also receive `update_plan`: their first call is a plan, shown as the same checklist, and they can update it and add finding cards during research. These are concise public progress summaries, not hidden model reasoning. The bounded research loop, frozen input, model/provider choice, billing attribution and cancellation checks still apply. A stopped or failed run may leave its last plan step marked working; the agent card is authoritative for run status. External MCP clients determine their own research process and model.

Implementation follows the [MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server). Protocol integration and backend behavior are covered by `app/tests/mcp.test.cjs`, `app/tests/plan-board.test.cjs`, `backend/tests/planning.test.ts` and `collaboration/agent.test.ts`.
