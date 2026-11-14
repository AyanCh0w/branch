# Branch

A collaborative canvas for branching conversations, research, notes, and media. Built with a local Node.js frontend server, React account/workspace UI, Convex, and Yjs. AI responses use server-side OpenAI Responses API calls with `gpt-5.4-mini`.

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

## Use a card in Codex or Claude Code

1. Run or update your Convex development deployment with `npx convex dev`, then build and open Branch. Sign in and open a board you can edit.
2. On a card, choose **Use in coding agent**. Open **Connect Codex or Claude Code**, create a connection key, and copy it. Export it as `BRANCH_MCP_KEY` in the environment that launches your coding client. For example, in zsh, run `read -rs 'BRANCH_MCP_KEY?Branch connection key: '`, paste the key, press Return, then run `export BRANCH_MCP_KEY`.
3. Copy the setup command for your client from the dialog. Run it in the repository where you use the coding assistant. Reopen or resume the client with the same environment to load Branch. If you use more than one board, use a distinct server name and environment variable for each key. A loopback Convex deployment is reachable only from the same machine.
4. Preview the card, select any context to include, and create the handoff. Paste its prompt into your session and add the task you want it to do. The agent reads the card and returns a text draft using the Branch MCP tools.
5. Open **Review coding draft** on the original card to read, discard, or publish the result. Use **Revoke handoff** to stop an outstanding handoff, or **Disconnect** in setup to revoke the board connection key.

Branch connection keys are separate from your coding provider credentials. Keep them in your local environment. Active handoffs expire after one hour. Files and images are omitted as attachments.

## Sync work from ChatGPT

1. Deploy this branch's frontend and Convex functions to a test environment. Set `BRANCH_APP_URL` in Convex to the frontend origin, with no path. The connector URL is the Convex HTTP site URL plus `/chatgpt/mcp`. If testing behind an HTTPS proxy, set `BRANCH_CONNECTOR_URL` in Convex to that proxy's origin and forward the MCP, OAuth and discovery routes there.
2. Open a board you can edit and use **ChatGPT** in the board header to copy the connector URL. In [ChatGPT Plugins](https://chatgpt.com/plugins), add a custom MCP server with that URL and OAuth. Use client metadata discovery when prompted. Sign in to Branch and choose an editable test board.
3. In a ChatGPT chat with the plugin selected, ask “Sync this chat's completed work to Branch as we go.” After the first save, switch from **Visualization** to **Context** next to the board title. The returned link and the card’s **Shared context** button open that conversation directly. Ask for a follow-up in the same chat to verify it adds to the same card.

The canvas shows the card title and the Shared context button. Board members with viewing access can open the updates. ChatGPT calls the connector during the conversation, subject to its tool selection and confirmation settings. The plugin does not independently monitor chats, import past transcripts, or receive assistant messages without a tool call. **Disconnect** in the board's ChatGPT settings revokes future access and keeps previously shared updates. The existing Codex and Claude Code handoff endpoint remains at `/mcp`.

For the ChatGPT-side setup and confirmation behavior, see [OpenAI's connector testing guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).
