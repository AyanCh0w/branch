# Supabase migration

This branch replaces the active Convex runtime with Supabase Auth, typed private Postgres tables, Storage, and Realtime invalidation. The original `convex/` tree and its tests remain as a rollback/parity reference; the running application does not import that tree.

Local builds and direct `node app/server.cjs` startup also audit the generated browser/API/worker bundles and reject stale Convex clients or endpoints. Rebuild after changing branches. The obsolete collaboration bundle is no longer served, and the Convex development launcher has been removed. Local configuration should contain only Supabase backend settings; retained parity tests run in memory and do not need a Convex deployment.

## Deployment status

Branch is live at **https://branch.eshteremberg.workers.dev**, using Cloudflare
Workers/Queues/Hyperdrive and the Supabase Branch project. The initial local
snapshot and the November 13, 2026 10:34 PM Pacific snapshot of hosted Convex
`expert-mallard-315` have both been imported. The additive live import includes
16 boards, 215 nodes, 43 completed runs, 8 username/password accounts, 2 teams,
board/team/link memberships, and 11 files. The destination totals are 21 boards,
237 nodes, 57 runs, 10 accounts, and 11 files. Existing destination records were
preserved; original account password hashes, IDs and Yjs state were retained.
Two source user IDs were already missing; non-login history placeholders preserve
their references without granting anyone their permissions. Old browser sessions,
editor leases and presence were intentionally omitted; sign in again or reopen
an invitation on the new host. The old Convex deployment remains intact and is
not continuously synchronized with Supabase.

The deployed runtime passed 214 automated tests plus hosted Auth, access control,
Storage, Realtime, concurrent editing, queue, share-preview and browser persistence
checks. The existing Convex OpenAI key was transferred, with explicit owner
approval, into the Cloudflare Worker's encrypted secrets. A real GPT-5.4 mini
response completed through the hosted queue and remained after a browser reload.
The temporary credential transfer file was deleted. No provider secret is in Git.

The final audit also corrected sign-in for imported usernames containing an email
address or space, while preserving the stricter new-account naming policy, and
fixed the external MCP launcher's remaining Convex client reference. Hosted
ChatGPT-plan connections remain deliberately disabled pending their separate
provider approval/configuration. Billing and email account recovery are not
implemented features; this migration does not enable them.

## Configure and run

1. Apply the numbered SQL files in `migrations/` in order. For an existing deployment using the first migration, run `node scripts/apply-relational-migration.cjs` to preview, then append `--apply`. `202611140003_github.sql` adds the GitHub tables ([docs/github.md](../docs/github.md)); apply it to an existing deployment before deploying code that includes it. It saves a private backup and atomically copies data into typed tables; field equality and foreign-key failures roll the migration back.
2. In the ignored root `.env.local`, configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `SUPABASE_DB_URL`. Legacy anon/service-role key variable names are also accepted. Use the session pooler connection URL for IPv4-only environments. Keep TLS verification enabled with `sslmode=verify-full` and `sslrootcert` pointing to the official Supabase certificate in `backend/certs/supabase-ca.crt` (downloaded from the database settings link). Use the correct deployment-local certificate path.
3. Preserve `OPENAI_API_KEY` and any existing `CHATGPT_*` server settings. Preserve the exact encryption key for imported personal ChatGPT connections; a new key cannot decrypt existing tokens.
4. Run `npm ci`, `npm run build`, then `npm run dev` and `npm run worker` in separate terminals. The app defaults to `http://127.0.0.1:4387`.
5. For local development, keep `npm run worker` running for shared AI generation. The hosted Cloudflare deployment runs jobs through Queues and a recovery cron; it does not depend on this local process. A frontend-only or Vercel-only deployment needs its own persistent worker before cutover.

Apply `202611140003_github.sql` and then `202611140004_agent_context.sql` if those migrations have yet to run. Migration 004 adds private coding handoff and ChatGPT reply tables, plus optional metadata on existing nodes. On development databases that already ran the earlier agent-context migration, 004 retains those tables and refreshes the compatibility view and write trigger after the GitHub migration. Existing board records, IDs, and Yjs text are preserved.

Only the project URL and publishable key reach the browser. Database credentials, secret keys, provider keys, and personal connection tokens stay on the server. Application records are in `branch_private`, which browser roles cannot access. The public revision table exposes only the signed-in user's own counter under RLS. Private file access uses signed URLs valid for one hour; previously issued URLs remain valid until expiry even if membership changes.

### Isolated ChatGPT sync development

On an Apple silicon Mac, run `SUPABASE_EXPERIMENTAL_STACK=1 npx --yes --package=supabase@3.1.0 supabase start --runtime native --preparation on-demand` from this checkout. This starts a separate local Supabase stack and applies all migrations. It does not require Supabase dashboard access, `supabase link`, or a production data import.

Save the local stack's API URL, publishable key, secret key, and database URL under the names above in an ignored `.env.agent-context.local` with file permissions `600`. Both URLs should point to loopback. Add `PORT=4390`, then run `npm run build` followed by `node --env-file=.env.agent-context.local app/server.cjs`. Chrome sync expects `http://localhost:4390/app` exactly. No OpenAI API key or job worker is needed to sync replies from ChatGPT.

In Chrome, load the unpacked extension from `extensions/branch-sync` (version `0.2.0`), then reload ChatGPT. Use a new local Branch account and board. Open an ordinary ChatGPT conversation, send a baseline message, then choose the test board from the **Branch sync** badge. Two new replies should show up on one card in **Context** and survive a reload. The baseline and any replies sent after **Stop syncing** should stay out of Branch.

For regular ChatGPT in the macOS app, use [Branch's menu bar app](../desktop/README.md). Approving a local board pairs it with one desktop conversation. The desktop endpoint accepts a short-lived capability, and saves only new assistant replies identified by the app. The bundled probe can check whether the selected window exposes the signals required for capture.

The board’s canvas tour ends with **Connect an agent**, also available from the account menu. ChatGPT setup points to the Mac menu bar app, includes the probe’s baseline prompt, and links to Chrome sync on the supported local address. Board editors can open the Claude Code connection setup from the same step, even before creating a card. Card handoffs still start from the source card.

## Data and account migration

Create a fresh backup from the actual source deployment. Coordinate a write freeze for a final cutover, or explicitly record the snapshot time and that later source writes are not synchronized. Keep the old deployment intact until validation and rollback decisions are complete. The original importer below requires an empty target database and never overwrites newer data.

```sh
# In the source project configured for the correct Convex deployment:
npx convex export --include-file-storage --path /absolute/private/backup.zip
# In this repository:
python3 scripts/prepare-convex-export.py /absolute/private/backup.zip backups/convex-export
node scripts/import-convex-to-supabase.cjs backups/convex-export
# Review counts, source deployment, target project, and backup first:
node scripts/import-convex-to-supabase.cjs backups/convex-export --apply
```

The private export and import manifest are ignored by Git. Original IDs and Yjs state are preserved. Username/password accounts move to Supabase Auth using their existing supported password hashes; usernames map to deterministic internal email identifiers, not deliverable email addresses. Existing login and guest sessions are intentionally not copied. Users sign in again and guests reopen invite links. In-flight generations stop rather than automatically reissuing paid requests. Imported personal provider connections still need their original encryption key and a compatible callback configuration.

The importer is resumable for recorded Auth and Storage steps. If interrupted between an external create and manifest persistence, inspect the new project's Auth/Storage state before retrying; do not delete user records or reset passwords blindly. Verify counts and file checksums, account login, permissions, editing, and generation before switching deployments. Keep the original source read-only while validating so the export does not silently diverge.

## Database layout

All app tables live in `branch_private` and have RLS enabled with browser roles denied. The server verifies Supabase identity and board/team membership before each operation. Select **branch_private** in Supabase's Table Editor to view them; there is deliberately no public raw-data API.

| Area | Dedicated tables |
| --- | --- |
| People and teams | `users`, `teams`, `team_members`, `team_invites` |
| Boards and access | `boards`, `board_members`, `project_responsibilities`, `board_links`, `link_members` |
| Canvas and generation | `nodes`, `runs`, `credit_ledger` |
| Collaboration | `sessions`, `board_presence`, `cursors`, `editors` |
| Files | `files`, `file_uploads`, `upload_tickets` |
| Provider connections | `chatgpt_connections`, `chatgpt_transactions`, `workspace_keys` |

Those 22 entity tables have typed columns, foreign keys, role/status checks, and indexes. Rich card contents, frozen AI input, and Yjs byte envelopes remain JSONB to preserve the app's document model. Chat messages live inside card content; they are not duplicated into an independently writable message table. Historical run connection IDs intentionally survive disconnecting the original provider connection.

Supporting tables are `accounts` (Supabase Auth to app-user mapping), `jobs`, `rate_limits`, `record_ids`, and `runtime_lock`. `public.branch_revisions` holds only account-scoped invalidation counters. `records` is now a compatibility **view** with guarded write triggers, while indexed collection reads use entity tables directly. `records_legacy_backup` preserves the pre-upgrade snapshot privately; it is not kept in sync and is not the live data source. The database also has Supabase-managed Auth and Storage tables, which this migration does not replace.

The second migration preserves every existing ID and compares every reconstructed record against the original JSON before committing. It does not erase old records or reset credentials. Never regenerate an already-deployed migration to add future fields: create a new numbered migration and update the entity mapping instead. `node scripts/build-entity-migration.cjs <name> <collection>...` generates one for new collections (after `npm run build:backend`) and updates `backend/entities.json`.

## Transactions and realtime

Business handlers retain the original permission and context-snapshot logic. Postgres writes serialize through one application-wide lock so membership changes and Send remain atomic. This conservative lock is suitable for the initial migration, not a high-throughput design; partitioning it requires real multi-connection race tests. Queries use repeatable-read snapshots. Runtime argument validation rejects IDs belonging to the wrong stored collection.

Mutations publish payload-free revision changes for affected accounts. Browser subscribers refetch through permission-checked API routes. Guests poll every second, and authenticated subscriptions recheck every three seconds as a fallback. This is a migration compatibility layer, not a full client-side replica of Postgres.

Jobs are inserted inside the Send transaction. Workers claim jobs using `SKIP LOCKED` and renew leases. Expired jobs fail together with their visible generation state, preserving partial output. An uncertain paid request is never automatically replayed. Agents continue through separately queued checkpoints.

## Validation

```sh
npm run test:supabase
npm run typecheck
npm test
npm run build:vercel
```

Supabase migration tests use PGlite's actual Postgres engine with RLS, the SQL schema, and the active business handlers. PGlite serializes test transactions; it does not substitute for hosted Auth/Storage/Realtime or real concurrent-connection testing. The older collaboration tests exercise the preserved Convex baseline separately. Do not report them as hosted Supabase integration tests.

Live verification scripts are opt-in and create temporary fixtures in the configured project. `verify-supabase-live.cjs` records exact IDs in ignored `backups/live-qa.json`; use `node scripts/cleanup-supabase-qa.cjs` to preview cleanup and append `--apply` to remove only those fixtures. Archive the cleaned manifest before a new run. `verify-supabase-runtime.cjs` tests the missing-provider error path only and refuses to run with a configured provider. Never use either test to claim real model generation has been verified.

## Cloudflare hosting

The Cloudflare build runs `npm run audit:runtime` against its generated browser,
API, worker, and static artifacts. It fails on Convex SDK imports, bundled clients,
or `.convex.cloud` / `.convex.site` endpoints. Retained `convex/` sources and dev
dependencies serve only legacy parity tests/rollback; active code uses `backend/`.
The live routing audit found no Convex URLs on active cards/files/boards or pending
runs. Completed imported run snapshots retain historical file URLs for provenance;
they are not replayed or used to display active files. The old Vercel deployment
is a separate preserved legacy site, not a fallback from Cloudflare.

The full app is hosted at **https://branch.eshteremberg.workers.dev**. It uses
Cloudflare Workers + Static Assets for the frontend/API, the `branch-jobs` Queue
for background generation, and Hyperdrive `branch-supabase` for PostgreSQL.
The Hyperdrive origin verifies the Supabase CA and hostname (`verify-full`);
SQL response caching is disabled so permissions and edits never use stale cache.
The existing Vercel/Convex deployment is preserved. `vercel.json` skips new
Vercel Git builds (`ignoreCommand: "exit 0"`) so pushing this migration cannot
replace that legacy deployment without its Supabase environment. Cloudflare is
the active deployment target; remove that override only for a deliberate
Vercel reactivation with its complete backend configuration.

Deploy with `npm ci && npm run deploy:cloudflare` after authenticating Wrangler.
The config is `wrangler.jsonc`; the bundle is generated in ignored `.worker-build/`.
The build explicitly selects the `workerd` package condition for PostgreSQL's
Cloudflare socket adapter. Static output is an allowlist; backups and `.env.local`
never enter the deployment. Set `SUPABASE_SECRET_KEY` and
`SUPABASE_PUBLISHABLE_KEY` using Wrangler secrets. The URL is a public variable.
Never put the secret key in client code. `OPENAI_API_KEY` is configured as a
Worker secret for default-provider generation. Hosted ChatGPT connections remain disabled
unless their separate approval and OAuth configuration have been completed.

Each API request/queue invocation owns its own PostgreSQL pool and closes it on
completion; sockets do not cross Worker lifetimes. Jobs are first committed to
PostgreSQL, then signaled through the queue. A once-per-minute recovery scan
requeues pending work if delivery failed. SQL claims and leases prevent duplicate
execution; an expired running job is failed rather than replaying an uncertain
paid AI request. No Mac process is required for the hosted backend.

Opt-in verification (creates named disposable QA fixtures):

```sh
BRANCH_APP_URL=https://branch.eshteremberg.workers.dev node scripts/verify-supabase-live.cjs
# Only while /api/status confirms no default AI key and the QA user has no connection:
BRANCH_APP_URL=https://branch.eshteremberg.workers.dev node scripts/verify-supabase-runtime.cjs
node scripts/cleanup-supabase-qa.cjs --apply
```

For a disjoint snapshot going into a populated target, use the additive importer:

```sh
node scripts/append-convex-snapshot.cjs backups/SNAPSHOT
# After reviewing the rollback rehearsal and destination backup:
node scripts/append-convex-snapshot.cjs backups/SNAPSHOT --apply
node scripts/verify-convex-append.cjs backups/SNAPSHOT
```

It refuses overlapping IDs/usernames, validates constraints in a rolled-back
transaction, preserves existing rows, copies password hashes without resets,
and verifies storage bytes by SHA-256. It saves a private destination backup
and resumable Auth/Storage manifest. Repeating a completed import is refused.
If documented source references point to missing users, the explicit
`--preserve-missing-users` option creates labeled history-only placeholders with
no Auth mapping or sessions; never map them to a different account. The live
November 13 import used this option for two missing source users.

Snapshots and manifests contain private data and stay in ignored `backups/`.
Do not upload them, commit them, or print credentials. Historical completed-run
inputs retain their original source URLs for fidelity; active file reads resolve
preserved storage IDs to private Supabase URLs. No old jobs are replayed.

Cloudflare validation: 214 automated tests passed (126 Node, 54 legacy parity,
34 Supabase/auth/request-scope tests), plus hosted signup/signin, wrong-password
rejection, member isolation/revocation, concurrent Yjs writes, private Storage
upload/download, Realtime/RLS, idempotent Send, and a queue-consumed failure
when no AI provider is configured. A browser edit survived reload. Share-link
HTML and WebAssembly-rendered PNG previews also passed; board IDs alone
returned 404. Disposable hosted QA accounts/board/file were cleaned afterward.
The final audit then configured the approved existing OpenAI key and verified a
real response, one completed job attempt, cleared generation state, and persistence
after reload. The MCP launcher regression covers actual process startup,
HTTP authentication, token refresh, and tool execution rather than only an
in-memory protocol server. The actual MCP process also authenticated against the
live Cloudflare app and listed/read its test board. A disposable QA identity
verified correct- and wrong-password handling for email-style and spaced legacy
usernames against hosted Supabase Auth; its original username was restored.

Connection-error regression checks cover both idle pools and checked-out transaction clients. Lost sockets fail with a sanitized error, discard the broken client, and never automatically replay a mutation or paid generation.
