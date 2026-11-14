# Supabase migration

This branch replaces the active Convex runtime with Supabase Auth, typed private Postgres tables, Storage, and Realtime invalidation. The original `convex/` tree and its tests remain as a rollback/parity reference; the running application does not import that tree.

## Deployment status

The free Branch project has been provisioned, the schema applied, and the local Convex export imported. Live checks cover Supabase Auth signup/sign-in, member isolation and revocation, concurrent Yjs writes, idempotent Send, private Storage, own-row RLS, Realtime notifications, browser editing/reload, and worker error handling. The original password hashes were preserved. Import counts are 2 accounts, 5 boards, 22 nodes, and 14 runs from the local Convex deployment; any separate hosted Convex database is not included. The temporary verification accounts and board were removed afterward. All 202 automated tests, backend type checking, and the production build passed. Actual AI responses remain unverified because this checkout has no provider key or ChatGPT connection. The frontend and worker currently run locally; hosted production cutover has not occurred.

## Configure and run

1. Apply both numbered SQL files in `migrations/` in order. For an existing deployment using the first migration, run `node scripts/apply-relational-migration.cjs` to preview, then append `--apply`. It saves a private backup and atomically copies data into typed tables; field equality and foreign-key failures roll the migration back.
2. In the ignored root `.env.local`, configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `SUPABASE_DB_URL`. Legacy anon/service-role key variable names are also accepted. Use the session pooler connection URL for IPv4-only environments. Keep TLS verification enabled with `sslmode=verify-full` and `sslrootcert` pointing to the official Supabase certificate in `backend/certs/supabase-ca.crt` (downloaded from the database settings link). Use the correct deployment-local certificate path.
3. Preserve `OPENAI_API_KEY` and any existing `CHATGPT_*` server settings. Preserve the exact encryption key for imported personal ChatGPT connections; a new key cannot decrypt existing tokens.
4. Run `npm ci`, `npm run build`, then `npm run dev` and `npm run worker` in separate terminals. The app defaults to `http://127.0.0.1:4387`.
5. Keep the worker running for shared AI generation. A frontend-only deployment does not run background jobs. Vercel hosts the API, but the worker requires a persistent Node process with the same server environment. Hosting for that process must be established before production cutover.

Only the project URL and publishable key reach the browser. Database credentials, secret keys, provider keys, and personal connection tokens stay on the server. Application records are in `branch_private`, which browser roles cannot access. The public revision table exposes only the signed-in user's own counter under RLS. Private file access uses signed URLs valid for one hour; previously issued URLs remain valid until expiry even if membership changes.

## Data and account migration

Create a fresh backup from the actual source deployment after stopping writes. Keep the old deployment intact until validation and rollback decisions are complete. The importer requires an empty target database and never overwrites newer data.

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

The second migration preserves every existing ID and compares every reconstructed record against the original JSON before committing. It does not erase old records or reset credentials. Never regenerate an already-deployed migration to add future fields: create a new numbered migration and update the entity mapping instead.

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

The full app is hosted at **https://branch.eshteremberg.workers.dev**. It uses
Cloudflare Workers + Static Assets for the frontend/API, the `branch-jobs` Queue
for background generation, and Hyperdrive `branch-supabase` for PostgreSQL.
The Hyperdrive origin verifies the Supabase CA and hostname (`verify-full`);
SQL response caching is disabled so permissions and edits never use stale cache.
The existing Vercel/Convex deployment is untouched.

Deploy with `npm ci && npm run deploy:cloudflare` after authenticating Wrangler.
The config is `wrangler.jsonc`; the bundle is generated in ignored `.worker-build/`.
The build explicitly selects the `workerd` package condition for PostgreSQL's
Cloudflare socket adapter. Static output is an allowlist; backups and `.env.local`
never enter the deployment. Set `SUPABASE_SECRET_KEY` and
`SUPABASE_PUBLISHABLE_KEY` using Wrangler secrets. The URL is a public variable.
Never put the secret key in client code. `OPENAI_API_KEY` is still required for
actual default-provider generation. Hosted ChatGPT connections remain disabled
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

The source import currently contains the earlier local Convex snapshot. The live
`expert-mallard-315` deployment was located in the browser (16 boards), but its
live import remains deferred as requested. It must be reconciled with existing
Supabase accounts before importing; never replace populated destination data.

Cloudflare validation: 204 automated tests passed (125 Node, 54 legacy parity,
25 Supabase/request-scope tests), plus hosted signup/signin, wrong-password
rejection, member isolation/revocation, concurrent Yjs writes, private Storage
upload/download, Realtime/RLS, idempotent Send, and a queue-consumed failure
when no AI provider is configured. A browser edit survived reload. Share-link
HTML and WebAssembly-rendered PNG previews also passed; board IDs alone
returned 404. Disposable hosted QA accounts/board/file were cleaned afterward.
Actual paid AI generation was not tested because no provider is configured.
