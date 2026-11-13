Shared boards now use Convex and Yjs. See [collaboration setup and boundaries](../collaboration/README.md). Build the browser bundle with `npm run build` before starting `npm run dev`.

# Branch — local planning canvas

## Run

```sh
node app/server.cjs
```

Open http://127.0.0.1:4387. Run from the repository root. Node 22+ is required. The server reads `OPENAI_API_KEY` from the environment or the root `.env.local` file (excluded from Git). Keep that file private. The static server exposes only the app's explicitly allowed browser assets.

## Live AI

All new chat responses use **gpt-5.4-mini only**, through the OpenAI Responses API. The model is fixed server-side; there is no fallback. The browser sends the active conversation and its resolved inherited context to the local server, which keeps the key out of browser JavaScript and storage. Local chat requests use `store: false`, a 12,000-token output limit, and a two-minute timeout. Output streams into the card; incoming blue flow ends when generation completes or fails. Errors appear in the card with Retry. Undo/delete abort in-flight requests.

Earlier demo responses remain in existing boards; new responses record their actual model and response ID. Accounts and shared boards use Convex Auth and Yjs; the frontend is still served locally.

Text notes contribute their contents. Supported images and PDFs contribute typed API inputs; YouTube cards can provide public captions. Website URLs trigger hosted web search at send time, with collaborator notes labeled separately. See the shared-board guide for access limits and frozen context behavior.

Verified with a real model request using an attached project code, plus a browser-generated response in the **Live AI · workspace plan** card. The API key and backend source return 404 over HTTP.

## Board interactions

- Drag titles/grips to move; resize from the diagonal handle. Cards stop where released.
- Two-finger scroll pans; pinch zooms. Right-click opens the compact creation menu. N/C/S create plan/chat/search; F fits the board.
- Chat plus opens note/upload/link options. Added sources become connected nodes. Source labels inside chats are inspection-only; use node/message nibs to branch.
- Branch snapshots inherit upstream sources, excluding siblings unless explicitly connected. User-prompt branches prefill that prompt and inherit preceding context. Selected text is excerpt context.
- Select text for a rounded highlight. Hover the selection handle to open a dark prompt; Enter runs it in a new chat. Blue nibs are visible on hover/focus and remain visible when connected.
- Paste YouTube URLs, website URLs, text, or images directly onto blank canvas. Drop local files to import. Text fields retain native paste.
- Wikimedia image search is live; drag results onto the board with a faded preview. YouTube uses pasted links, thumbnail cards, and click-to-play embedded players. Websites use embedded previews with a browser fallback when framing is blocked.
- Shared uploads use board-scoped Convex storage (25 MB per file) with an IndexedDB preview cache. Shared board state persists in Convex and Yjs documents. Undo is session-local.

## Validation

```sh
node --check app/app.js
node --check app/server.cjs
node --test app/tests/*.test.cjs
```

Tests cover immutable upstream context, sibling isolation, message cutoffs, excerpt/prompt branching, safe URL parsing, hidden-port geometry, fixed-model request construction, and streaming event parsing.

New response words fade in over 130 ms without stagger or delivery delays. Reduced-motion preferences disable the fade. New content-bearing nodes receive short AI-generated titles using only gpt-5.4-mini; existing names and manually edited titles are preserved. Search controls keep their functional title. Title generation uses the server-side /api/title endpoint.

## Public landing page

`/` serves the standalone Branch landing page (`landing.html`, `landing.css`, `landing.js`). `/app` opens the board library or sign-in; `/app?auth=signup` starts account creation for signed-out visitors. Existing `/?board=…` board URLs still open the workspace, and the landing script forwards legacy `/#join=…` invitations to `/app#join=…` without losing their token.

The hackathon walkthrough is an illustrative, local-only example: its three tabs change emphasis and frame the relevant cards on mobile. Arrow keys, Home, and End navigate the steps. It does not call an AI API or edit a board. Replace the marked `.canvas-viewport` slot with the final captioned video when available; retain the static board as the video poster. No video asset is included yet.
