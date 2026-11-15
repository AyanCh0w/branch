# Branch

A collaborative canvas for branching conversations, research, notes, and media. Built with a local Node.js frontend server, React account/workspace UI, Supabase, and Yjs. AI responses use server-side OpenAI Responses API calls with `gpt-5.4-mini` by default. An approval-gated Sign in with ChatGPT integration lets connected users choose models available to their own plan.

## Local setup

Use Node.js 22 or newer and npm.

```sh
npm ci
cp .env.example .env.local
```

Configure Supabase using [the migration and deployment guide](supabase/README.md), including the SQL migration and private `.env.local` settings. Shared AI generation requires the API server **and** a running background worker. This migration branch is not a verified production cutover yet.

```sh
npm run build
npm run dev
# In another terminal:
npm run worker
```

Open http://127.0.0.1:4387 for the landing page or http://127.0.0.1:4387/app for accounts and boards. The frontend binds to loopback; sharing with other devices requires a reachable frontend deployment. Publishing this repository does not deploy the application or copy existing board data.

## Validation

```sh
npm test
npm run typecheck
```

The tests include local HTTP server checks, which require permission to listen on loopback. Generated browser bundles, KaTeX assets, PDF.js assets, dependencies, and `.env.local` are ignored; rebuild after cloning.

## Project layout

- `app/`: canvas, landing page, local server, media viewers, assets, and browser-oriented tests.
- `accounts/`: React accounts, board library, sharing, and workspace UI.
- `backend/`: Supabase-backed accounts, permissions, shared documents, and durable AI jobs.
- `supabase/`: database migration and deployment/import guide.
- `docs/github.md`: connecting a board to GitHub repositories (GitHub App setup).
- `convex/`: original backend retained for rollback and parity tests.
- `collaboration/`: Yjs client integration, context processing, research helpers, and backend tests.

See [shared-board architecture and limitations](collaboration/README.md) and [canvas interactions](app/README.md) for details. Email recovery and billing are not implemented.

## Vercel hosting

Vercel uses `npm run build:vercel` to copy browser assets into `public/`, with Node API handlers in `api/`. Configure the Supabase and provider server environment there. The persistent background worker needs separate Node hosting; deploying the frontend alone does not process AI jobs. See the migration guide before changing production.

The Vercel project should connect to `AyanCh0w/branch` with `main` as its production branch. The landing page is `/`, accounts and boards are `/app`, and existing `/?board=…` URLs still open the canvas. Local startup remains `npm run dev`. Development identity migration routes are disabled in hosted mode; do not configure the development bridge secret on Vercel.

## ChatGPT plan connections

AI settings replaces custom workspace API keys with personal ChatGPT connections and account-specific model choices. Hosted plan usage requires an approved OpenAI client; the feature stays unavailable until configured. The existing default model remains available. See [setup, security, and rollout requirements](collaboration/README.md#chatgpt-connections-and-model-choice).

## Shared agent Context

Open a board and use the **Context** tab beside its title. This shows synced ChatGPT conversations and coding results grouped under their source cards.

- On a card, choose **Use in coding agent**. Review the card and select its sources, then copy the handoff instructions into Codex or Claude Code. Paste the approval code back into Branch to grant access. When the draft arrives, review it and choose **Publish as note** to share it with the board.
- For automatic ChatGPT reply sync, apply the agent Context migration and run Branch with `PORT=4390 npm run dev`. Open `http://localhost:4390/app` and sign in. In Chrome, use **Load unpacked** to load `extensions/branch-sync` from this checkout. Reload an existing ChatGPT conversation, click **Branch sync**, choose an editable board, and click **Start syncing**. Later completed replies appear on the same Context card. Use **Stop syncing** from the chat or **Disconnect Chrome chats** from the board’s Context view. Sync captures rendered replies while the chat is open, so changes to ChatGPT’s page can affect capture.
