# Branch

A collaborative canvas for branching conversations, research, notes, and media. Built with a local Node.js frontend server, React account/workspace UI, Convex, and Yjs. AI responses use server-side OpenAI Responses API calls with `gpt-5.4-mini` by default. An approval-gated Sign in with ChatGPT integration lets connected users choose models available to their own plan.

## Local setup

Use Node.js 22 or newer and npm.

```sh
npm ci
cp .env.example .env.local
```

Configure your own Convex development deployment with `npx convex dev`, then set `CONVEX_URL` in `.env.local` to its deployment URL. Set `OPENAI_API_KEY` locally for the local AI endpoints and in your Convex deployment environment for shared chat and research runs. Keep credentials out of Git. The Convex schema and authentication components live in `convex/`.

```sh
npm run build
npm run dev
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
- `convex/`: authenticated backend, storage, shared documents, and AI runs.
- `collaboration/`: Yjs client integration, context processing, research helpers, and backend tests.

See [shared-board architecture and limitations](collaboration/README.md) and [canvas interactions](app/README.md) for details. Email recovery and billing are not implemented.

## Vercel hosting

Vercel uses `npm run build:vercel` to copy an explicit set of browser assets into `public/`, with Node.js API handlers in `api/`. Set `CONVEX_URL` and `OPENAI_API_KEY` as server-side Vercel environment variables. Continue to configure the shared AI key in Convex separately. The hosted frontend can use the same Convex deployment as the local app; hosting does not migrate or reset existing accounts and boards.

The Vercel project should connect to `AyanCh0w/branch` with `main` as its production branch. The landing page is `/`, accounts and boards are `/app`, and existing `/?board=…` URLs still open the canvas. Local startup remains `npm run dev`. Development identity migration routes are disabled in hosted mode; do not configure the development bridge secret on Vercel.

## ChatGPT plan connections

AI settings replaces custom workspace API keys with personal ChatGPT connections and account-specific model choices. Hosted plan usage requires an approved OpenAI client; the feature stays unavailable until configured. The existing default model remains available. See [setup, security, and rollout requirements](collaboration/README.md#chatgpt-connections-and-model-choice).
