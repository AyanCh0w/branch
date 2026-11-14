-- Server-only document tables preserve existing board IDs and Yjs byte states.
-- No browser role can read raw documents, profiles, capabilities, or provider tokens.
create schema if not exists branch_private;
revoke all on schema branch_private from public, anon, authenticated;
create table if not exists branch_private.runtime_lock(id integer primary key);
insert into branch_private.runtime_lock(id) values(1) on conflict do nothing;
alter table branch_private.runtime_lock enable row level security;
create table if not exists branch_private.records (
 id text primary key, collection text not null, created_at double precision not null,
 data jsonb not null check(jsonb_typeof(data)='object')
);
create index if not exists records_collection on branch_private.records(collection);
create index if not exists records_board_key on branch_private.records(collection,(data->>'boardId'),(data->>'key'));
create index if not exists records_board_user on branch_private.records(collection,(data->>'boardId'),(data->>'userId'));
create index if not exists records_user on branch_private.records(collection,(data->>'userId'));
create index if not exists records_owner on branch_private.records(collection,(data->>'ownerId'));
create index if not exists records_team on branch_private.records(collection,(data->>'teamId'));
create index if not exists records_token on branch_private.records(collection,(data->>'tokenHash'));
create table if not exists branch_private.accounts (
 auth_id uuid primary key, user_id text unique not null references branch_private.records(id),
 username text unique not null check(username=lower(username))
);
create table if not exists branch_private.jobs (
 id uuid primary key, function_name text not null, args jsonb not null,
 due_at timestamptz not null, status text not null default 'pending',
 lease_until timestamptz, owner uuid, attempts integer not null default 0,
 error text, created_at timestamptz not null default now()
);
create index if not exists jobs_ready on branch_private.jobs(status,due_at);
create table if not exists branch_private.rate_limits (
 bucket text primary key, window_start timestamptz not null, count integer not null
);
alter table branch_private.records enable row level security;
alter table branch_private.accounts enable row level security;
alter table branch_private.jobs enable row level security;
alter table branch_private.rate_limits enable row level security;
revoke all on all tables in schema branch_private from public,anon,authenticated;
-- Payload-free invalidations: clients still fetch through permission-checked APIs.
create table if not exists public.branch_revisions (
 user_id uuid primary key, revision bigint not null default 0
);
alter table public.branch_revisions enable row level security;
revoke all on public.branch_revisions from public,anon,authenticated;
grant select on public.branch_revisions to authenticated;
create policy own_revision on public.branch_revisions for select to authenticated using (user_id=auth.uid());
-- Supabase storage bucket is private. Upload/download URLs are short-lived.
insert into storage.buckets(id,name,public,file_size_limit) values ('branch-files','branch-files',false,26214400) on conflict(id) do nothing;
-- Add once on projects where Realtime is installed.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='branch_revisions') then
  alter publication supabase_realtime add table public.branch_revisions;
 end if;
end $$;
