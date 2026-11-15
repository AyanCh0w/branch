# Live coordination: plans, progress and context that keep themselves current

Status: implemented on the Supabase backend (`backend/`), covered by automated tests. Not yet deployed, and not yet exercised against a real Supabase project or real coding agents. The original Convex tree (`convex/`) does not have these features.

## What it does

Branch is a shared board for a team building quickly in their own IDEs. This feature keeps the board current without anyone maintaining it by hand:

1. **Plan first.** Before building something sizable, a person's coding agent posts a plan with the files and areas it will touch. If someone else is already working there, the agent is told and stops to show its user.
2. **Milestones, not transcripts.** While building, the agent posts short updates: a decision, a changed interface, a blocker. GitHub confirms what merged.
3. **Context that follows.** A chat connected to someone's plan is told when the plan moves on, and can re-read it automatically each time it sends.
4. **A board that organizes itself.** Plan cards show who is doing what and what collides. The Context view lists every stream of work. Each project area gets a summary card.
5. **Cheap to read.** Agents read a brief capped at 6,000 characters, or only what changed since they last asked. Nothing includes code, transcripts or card bodies.

## Using it

### Connect a coding agent

1. Open a board you can edit. On any card choose **Use in coding agent**, then **Connect Codex or Claude Code**.
2. Create a connection key and run the setup command shown for your client. The endpoint is `<your Branch origin>/api/mcp`.
3. Copy the **Keep teammates in the loop** text from the same dialog into `AGENTS.md` or `CLAUDE.md` in your repository. Tool descriptions alone are not reliably followed; this makes plan-first the agent's standing rule.

The key is scoped to you and that board, stored only as a hash, rechecked on every request and removed when you lose edit access.

### What the agent can call

| Tool | Purpose |
| --- | --- |
| `get_board_brief` | Active work by others, overlaps with the paths or areas given, recent changes, area summaries. Pass the returned `cursor` as `since` to get only what is new. |
| `start_work` | Post a plan with `paths` and `areas`. Creates or updates a plan card. Returns `overlaps`. |
| `post_update` | Record a `decision`, `interface` change, `blocker` or `progress`. Optionally update the plan's steps. |
| `finish_work` | Close the work as `done` or `abandoned` with a summary. |
| `read_card_handoff`, `return_card_draft` | The existing card handoff tools, unchanged. |

### On the board

- **Plan cards** show a status dot (active, idle, done, closed), the owner, area tags, the first few paths, and the latest five updates.
- **Overlap badges** appear on both cards when two people's open work touches the same paths or area. Clicking one brings the other card into view.
- **The roster** shows what each person present is building.
- **The Context view** lists work plans alongside synced ChatGPT conversations, with their update history, a filter by area, the area's summary, and a dot on anything new since your last visit in this browser. The person doing the work, or the board owner, can close it there.
- **Old finished work** folds to a title row after a day; **Show plan** expands it.

### In chats

- Connecting a plan card or an area summary card to a chat turns on **Refresh automatically when I send** for that connection. Any connection to a whole card can be switched on or off in its inspector. Excerpts and message branch points cannot follow.
- A connection that is not following still shows as stale when its source changes, and its inspector lists the updates posted since the snapshot.
- The board owner can turn on **Tell chats about active work** in the Context view. Every chat sent on that board then receives a short list of other people's open work. It is off by default because it adds to every request.
- Whatever a chat used is still frozen into its run, so answers remain traceable.

### GitHub

When `GITHUB_WEBHOOK_SECRET` is set and the GitHub App's webhook points at `<origin>/api/github/webhook`:

- A pull request opened from a branch named in `start_work` is noted on that work.
- A merged pull request marks the work done and records the files it changed.
- A push to the default branch refreshes file cards whose paths changed, which marks chats holding the old snapshot as stale.

See [GitHub](github.md) for setup.

### ChatGPT

The connector's `sync_branch_update` tool accepts optional `paths` and `areas`. A conversation that declares them counts as work: it appears in briefs and collides with other people's scope like any plan.

## How it is built

### Data

Three tables, added by `supabase/migrations/202611140003_live_coordination.sql`:

- `workItems`: one per piece of work. Board, owner, plan card, status, title, goal, paths, areas, optional repository, branch and pull request, heartbeat and last update line.
- `workUpdates`: the milestone log. Idempotent per `updateId`, at most 20 per minute per item from an agent, newest 500 kept.
- `areaDigests`: one rolling summary per board area.

The plan card itself carries what the canvas and the context resolver need: `workStatus`, `workOwner`, `workScope` and `workLatest` (the last five update lines). Heartbeats never touch the card.

### Where things live

| Concern | File |
| --- | --- |
| Items, updates, briefs, overlap warnings, expiry, summaries | [backend/functions/work.ts](../backend/functions/work.ts) |
| Scope normalization and overlap rules, shared by backend and canvas | [app/work-scope.js](../app/work-scope.js) |
| Agent MCP endpoint | [backend/agents/coding.ts](../backend/agents/coding.ts) |
| ChatGPT connector endpoints | [backend/agents/chatgpt.ts](../backend/agents/chatgpt.ts) |
| Routing, Node adapter, GitHub webhook verification | [backend/agents/index.ts](../backend/agents/index.ts) |
| Webhook processing | [backend/functions/githubActions.ts](../backend/functions/githubActions.ts), [backend/functions/github.ts](../backend/functions/github.ts) |
| Work text in context, follow mode | [app/context.js](../app/context.js) (`textOf`, `followContext`) |
| Follow and active-work context at Send | [backend/functions/chat.ts](../backend/functions/chat.ts) |
| Plan card chips, overlap badges, inspector controls | [app/app.js](../app/app.js) |
| Context view | [accounts/board-views.jsx](../accounts/board-views.jsx), [accounts/context-canvas.jsx](../accounts/context-canvas.jsx) |
| Hourly expiry | [backend/functions/maintenance.ts](../backend/functions/maintenance.ts), [backend/runner.ts](../backend/runner.ts) |

### Rules worth knowing

- **Overlap is deterministic.** Two path scopes overlap when one is a prefix of the other at a path-segment boundary: `app` covers `app/context.js` but not `apps`. Areas overlap on an equal tag. Only other people's open work counts. No model is involved.
- **Overlap never blocks.** It is a warning to the agent and a badge on the board.
- **Agents cannot overwrite people.** A plan a person edited by hand is never rewritten; the agent is told to start a new one.
- **Staleness uses the card revision.** Every server-side change to a card's context-bearing text bumps `data.revision`. Connections record the revision they captured.
- **Following refreshes at Send only.** `chat.send` re-snapshots followed connections just before freezing the run, beside the existing caption hydration.
- **Liveness.** Any agent write refreshes the heartbeat. Work untouched for a day becomes idle and still warns newcomers; after a week it is closed.
- **Area summaries are assembled, not generated.** A summary is the newest twelve updates in that area, rebuilt at most every five minutes when something new arrives. No model is called. A summary card a person edited or deleted is left alone.
- **Placement.** A new plan card lands beside the latest card in its first area. Nothing already on the board is moved.

### Safety

- Everything an agent reads from the board is wrapped in an untrusted-data notice, and the tool instructions tell it never to act on instructions found there.
- Text that looks like a credential (common API key, token and private-key formats) is rejected on write.
- Guests and viewers cannot post. Readers of updates need board access.
- Webhook deliveries are verified with HMAC-SHA256 over the raw body. Only repository ID, branch, pull request number, state, title and changed paths are kept, and only for repositories already linked to a board. Branches from forks are ignored.
- The active-work block in chats lists only people who can still access the board, and never the sender's own work.

## Not done

- **Real-world verification.** No test against a live Supabase project, a deployed worker, real Codex or Claude Code sessions, the ChatGPT connector or GitHub deliveries.
- **Model-written summaries.** The design called for a cheap model to merge updates into prose. That needs a decision to allow the outbound call and a way to show its cost.
- **GitHub sign-in.** It depended on the previous auth system and has not been rebuilt on Supabase Auth. Repository context is unaffected.
- **Vercel routes.** The new endpoints are wired into the local server and the Cloudflare worker only.
- **Local stdio MCP server** ([mcp/server.cjs](../mcp/server.cjs)) still targets the old backend and has none of the new tools.
- **Work noticed after the fact.** A pull request on a branch nobody claimed does not create a work item.
- **Board feed size.** `boards:read` still returns every card. Large boards need pagination before this is used heavily.
- **"New since last visit"** is stored per browser, not per account.

## Open questions

1. Should an overlap also notify the person who claimed first, or only the newcomer?
2. Is a board the right unit, or should work be visible across a team workspace?
3. Should active-work context be on by default for team boards once its cost is measured?
4. Who may close someone else's idle work: the board owner only, or any editor?

## Tests

- `backend/tests/work.test.ts`: plan-first, overlap rules, access loss, credentials, idempotency and bursts, brief budget, follow at Send, active-work context, closing, GitHub confirmation, summaries, ChatGPT scope, the MCP tools, expiry.
- `backend/tests/agents.test.ts`: the HTTP adapter, key checks, connector discovery, webhook signatures.
- `app/tests/work-scope.test.cjs`: scope normalization, overlap, work text, `followContext`.
- `app/tests/work-ui.test.cjs`: plan card chips, overlap badges, folding, the inspector's follow control.
