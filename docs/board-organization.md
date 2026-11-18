# Board organization: plans people can read, context agents can use

Status: built on the `feat/board-organization` branch, tested locally, not deployed. It needs no database migration.

**Update, after the first real agent run.** A real Claude Code session produced 60 cards in a strip 1,300 × 10,400 px, with lines over cards, 41 source cards for 18 ideas, and 17 cards orphaned by a plan rewrite. The lane layout described below was replaced by the rules in [mcp/README.md](../mcp/README.md#how-the-board-stays-readable): one board that builds down and out, budgets with folding, a home for every card, conclusions on the canvas and research in Context, one card per topic, sources as chips, attributed edits, and Organize. Sections below that describe lanes, connectors and source cards are history.

## What went wrong in the taco-truck run

An agent was asked to plan a taco truck. It produced a "Work plan" note and several finding and decision notes, each many paragraphs long, piled in one column with crossing lines. Nothing appeared in Context. Three causes:

1. **The canvas accepted anything.** `update_plan` took 4,000 characters per step and `add_card` took 24,000 per note, and the server's instructions told agents to put evidence, uncertainty and next actions into notes. Plans and notes were stored as one block of plain text, so the canvas could only show paragraphs.
2. **Placement guessed at sizes.** Every new card was dropped at the same starting point and pushed down past cards assumed to be 260 px tall. Long notes are far taller, so they overlapped. Lines ran from each source's right edge to each target's left edge, whatever their positions, so they crossed.
3. **Only one of the two agent paths wrote to Context.** The local MCP server (the one Claude Code used) had no way to reach Context. Only connected board agents did, and only when the model chose to call `publish_update`.

## What is built

| Layer | Before | Now |
| --- | --- | --- |
| Canvas | Free-form notes | A checklist plan, and short cards typed as decision, finding, question, risk or note. Limits are enforced: title 60 characters, summary 200, four points of 140 |
| Context | Empty unless an agent chose to post | Every plan change, card and source an agent writes adds a Context entry with the full reasoning, in the same transaction |
| Layout | One column, overlapping | Lanes: plan, then cards in step order, then each card's sources. Recomputed on every agent write |
| Lines | Crossing diagonals | Right-angle connectors from each step that share one vertical channel, like a tree |
| Sources | URLs pasted into note text | Website cards, YouTube video cards and file cards, placed beside the card they support |
| Agents reading the board | `read_board` returned every card's full text | `get_brief` returns the plan, decisions, open questions and sources in a few kilobytes |
| A person's decision | Stayed in their own chat | `record_decision` adds a decision card and changes the shared plan in one call; other agents see it in `get_brief` |
| People changing the plan | Typing into the note blocked all later agent updates | Click a step's status on the card. The plan version rises, so an agent with an older copy must read again |

Both agent paths use the same code (`backend/functions/planning.ts`) and the same tool text (`collaboration/plan-tools.cjs`). Calls from older copies of the local MCP server are shortened the same way: the first sentence becomes the card and the full text moves under **Details** and into Context.

To see it without an account or database: `npm run demo:plan-board`, then open http://127.0.0.1:4399.

## Ways to keep a board organized

**Built** is on this branch. **Next** is small and needs no decision. **Decide** changes behavior the team should agree on first.

### What agents are allowed to put on the canvas

| # | Idea | Status |
| --- | --- | --- |
| 1 | Structured cards with hard length limits, enforced by the server with a message telling the agent to move the rest into `detail` | Built |
| 2 | One idea per card, typed as decision, finding, question, risk or note, each with its own label and color | Built |
| 3 | A plan is a checklist: a goal, steps with a status and a one-line note, and a progress bar | Built |
| 4 | Full reasoning stays one click away under **Details** on the card, collapsed by default | Built |
| 5 | Shorten free-form notes from older clients to their first sentence | Built |
| 6 | A cap of 80 cards per plan so an agent cannot flood a board | Built |
| 7 | Apply the same limits to the in-app research agent's finding notes | Next |
| 8 | A per-board "density" setting (headlines only, standard, detailed) that agents read from `get_brief` | Next |
| 9 | Let an agent merge or retire its own cards when a finding is superseded, so stale cards do not pile up | Next |
| 10 | A rule that an agent may not add a second card on a topic that already has one, enforced by title similarity | Decide |

### Layout

| # | Idea | Status |
| --- | --- | --- |
| 11 | Lanes in plan-step order; rows never overlap | Built |
| 12 | Sources sit to the right of the card that cites them | Built |
| 13 | A new plan starts in clear space beside existing work | Built |
| 14 | Dragging the plan card carries its lanes; dragging a card carries its sources | Built |
| 15 | A card a person moves stays where they put it; **Tidy** returns everything to its lane | Built |
| 16 | Collapse the cards of finished steps into the step's count badge | Next |
| 17 | A second layout for wide screens: steps 1–3 to the left of the plan and the rest to the right, which halves the height | Next |
| 18 | A column-per-step layout (kanban) as an alternative to lanes | Decide |
| 19 | Measure real card heights in the browser to tighten spacing. Not done because two browsers with different fonts would keep correcting each other | Decide |
| 20 | **Tidy** for boards people built by hand, not only agent plans | Next |
| 21 | Labelled frames a person can draw around a group of cards, which agents see as named areas | Next |

### Lines

| # | Idea | Status |
| --- | --- | --- |
| 22 | Right-angle connectors that share one channel per plan | Built |
| 23 | Lines start at the step they belong to, not at the corner of the plan card | Built |
| 24 | A source cited by two cards gets one line, to the first; the second card shows a source count instead | Built |
| 25 | Highlight a step's branch when the step is hovered or focused | Next |
| 26 | Choose the nearest sides for every context line on the board, including hand-made ones | Next |
| 27 | Hide plan lines until a card is hovered, relying on step labels | Decide |

### Sources

| # | Idea | Status |
| --- | --- | --- |
| 28 | A link becomes a website card, a YouTube link becomes a video card, text becomes a file card | Built |
| 29 | Compact source cards with a one-line "why it matters"; **Preview** opens the full website card | Built |
| 30 | The same URL is added once per board and reused | Built |
| 31 | Sources are real context: a chat branched from a decision inherits the sources behind it | Built |
| 32 | Upload a local PDF or image from the local MCP server as a file card | Next |
| 33 | GitHub files, issues and pull requests as sources, using the existing GitHub cards | Next |
| 34 | Quote cards: an exact excerpt with a line back to its position in the source | Next |
| 35 | Mark a source as "read" only when the server fetched it, so a card cannot imply a page was read when it was not | Decide |

### Context layer

| # | Idea | Status |
| --- | --- | --- |
| 36 | Every agent write logs its full reasoning to Context automatically | Built |
| 37 | The local MCP server gets its own Context row, named after the client and the person | Built |
| 38 | `get_brief`: a compact digest for agents, with a reminder of when to write | Built |
| 39 | A canvas card opens its Context entry, and a Context entry opens its card | Built |
| 40 | Filter Context by kind (decisions, plan changes, findings) and by plan step | Next |
| 41 | A "what changed since you last looked" summary when a person opens the board | Next |
| 42 | Claude Code and Codex hooks: load the brief at session start and post each turn, so nothing depends on the model remembering | Next (see `connector-and-hooks-plan`) |
| 43 | Store updates in the structured shape from the connector proposal (working on, decisions, assumptions, open questions, blocked on). Needs a migration | Decide |

### Keeping one plan current for everyone

| # | Idea | Status |
| --- | --- | --- |
| 44 | `record_decision`: one call records the decision and changes the plan steps it affects | Built |
| 45 | The plan card shows who changed it last and what changed | Built |
| 46 | Every agent sees recent plan changes and decisions at its next `get_brief` | Built |
| 47 | Stale writes are refused with the current version, so two agents cannot overwrite each other | Built |
| 48 | Tool instructions tell agents to record a decision as soon as a person makes one, including mid-coding | Built |
| 49 | Any editor's agent can update the shared plan | Built, **Decide** (see below) |
| 50 | A "propose only" mode where other people's agents suggest plan changes for a person to accept | Decide |
| 51 | Notify teammates in Branch when a decision changes a step they own | Next |
| 52 | Flag conflicts: two decisions on the same step by different people | Next |

### People in control

| # | Idea | Status |
| --- | --- | --- |
| 53 | Change a step's status from the plan card | Built |
| 54 | Text a person types into a card is never overwritten; the card keeps their wording | Built |
| 55 | Rename, add, remove and reorder steps from the plan card | Next |
| 56 | Accept or dismiss an open question from its card, which records the answer as a decision | Next |
| 57 | Undo an agent's last plan change from the plan card | Next |
| 58 | Owners choose which card kinds agents may create on a board | Decide |

## Decisions for the team

1. **Who may change the shared plan.** The new tools let any board editor's agent update the plan, with every change versioned, attributed and logged. The older rule (only the account that created a plan) still applies to calls from older clients. The alternative is idea 50.
2. **The local MCP tool list changed.** `add_card` now takes structured fields. Draft chats moved to `add_chat_draft`. Older installed copies keep working against the new backend.
3. **Layout style.** Lanes read top to bottom next to the checklist and grow tall on large plans. Ideas 16–18 are the options.
4. **Deploy order.** Backend and frontend should ship together. New cards look like plain short notes in a browser tab that has not reloaded.

## Not verified

- The Context view change (opening the entry for a card) was built and type-checked but not exercised in a browser, because the Context view needs a signed-in backend.
- Real agents were not run against this. The end-to-end test drives the same MCP tools a model would call, with a scripted taco-truck session.
- Card heights are estimated on the server from text length. They matched the browser within one line on the test board; unusual text (very long words, other scripts) could leave a card a line taller than its slot.
