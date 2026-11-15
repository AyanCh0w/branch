# Convex backend

Branch runs its data, accounts, files, live updates, AI runs and scheduled work on [Convex](https://convex.dev). The Node app server (`app/server.cjs`, hosted as a Cloudflare Worker) serves the site, the AI proxy routes and share previews, and forwards three HTTP endpoints to Convex.

## Set up

1. `npm ci`, then `npx convex dev`. Pick or create a project. This writes `CONVEX_DEPLOYMENT`, `CONVEX_URL` and `CONVEX_SITE_URL` to `.env.local` and keeps `convex/` deployed while it runs.
2. Generate a long random proxy secret and set it in both places:
   - `.env.local` (and the hosted app server): `BRANCH_PROXY_SECRET=...`
   - Convex: `npx convex env set BRANCH_PROXY_SECRET <value>` (add `--prod` for production)
3. Set provider settings on Convex with `npx convex env set`: `OPENAI_API_KEY`, `WORKSPACE_KEY_ENCRYPTION_KEY`, the `CHATGPT_*` values and the four `GITHUB_*` values ([GitHub setup](github.md)).
4. `npm run build`, then `npm run dev`.

Deploy functions to production with `npx convex deploy`. Deploy the site with `npm run deploy:cloudflare`; set `CONVEX_URL`, `CONVEX_SITE_URL` and `BRANCH_PROXY_SECRET` as Worker variables/secrets.

## Forwarded endpoints

`/api/backend?coding` (Claude Code card handoffs over MCP), `?chrome=` (Chrome extension) and `?desktop=` (Mac app) keep their URLs. `collaboration/backend-proxy.cjs` applies the origin and loopback rules, then forwards to the Convex HTTP actions in `convex/http.ts`, which reject any request without `BRANCH_PROXY_SECRET`. Tests: `app/tests/backend-proxy.test.cjs`, `collaboration/sync-http.test.ts`.

## Call budget

The free plan includes 1M function calls a month. In Convex every mutation is a call, and so is every re-run of a subscribed query on every client watching it. A write that a query reads therefore costs `1 + viewers` calls. Earlier versions ran out of calls because of high-frequency writes. Keep these limits when changing collaboration code:

| Activity | Rate | Notes |
| --- | --- | --- |
| Cursor position | ≤ 4/s while moving, 1 per 10 s idle | `collaboration/cursors.js`. Remote cursors glide with a CSS transition. Writes touch only the sender's row. |
| Board attendance | 1 per 20 s per tab | Expires after 60 s; leaving the page clears it at once. |
| Editing lease | 1 per 10 s while focused | Lease lasts 30 s. |
| Typing | ≤ ~2 saves/s | `schedule()` in `collaboration/client.js`: first save 150 ms after a change, then at most one per 600 ms. Blur and Send flush immediately. |
| AI streaming | ≤ 4/s per reply | In-progress text goes to the `streams` table (`chat:streams`), not the card. The card is written once when the reply finishes or stops, so `boards:read` does not re-run per chunk. |
| Cleanup | every 10 min | `crons.ts` sweeps expired cursors, attendance and leases. |

`boards:read` re-sends every card to every viewer whenever any card on the board changes, so it is the most expensive query. Don't add frequently changing fields to `nodes`. Put them in their own table with a small query, as `streams` does.
