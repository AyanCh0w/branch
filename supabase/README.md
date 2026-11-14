# Supabase migration

This branch replaces the active Convex runtime with Supabase Auth, private Postgres records, Storage, and Realtime invalidation. The original `convex/` tree and its tests remain as a rollback/parity reference; the running application does not import that tree.

## Deployment status

The free Branch project has been provisioned, the schema applied, and the local Convex export imported. Live checks cover Supabase Auth signup/sign-in, member isolation and revocation, concurrent Yjs writes, idempotent Send, private Storage, own-row RLS, Realtime notifications, browser editing/reload, and worker error handling. The original password hashes were preserved. Import counts are 2 accounts, 5 boards, 22 nodes, and 14 runs from the local Convex deployment; any separate hosted Convex database is not included. The temporary verification accounts and board were removed afterward. All 201 automated tests, backend type checking, and the production build passed. Actual AI responses remain unverified because this checkout has no provider key or ChatGPT connection. The frontend and worker currently run locally; hosted production cutover has not occurred.

## Configure and run

1. Create a Supabase project and apply `migrations/202611140001_branch.sql` using its SQL editor or a trusted migration runner.
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
