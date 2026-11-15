-- Routing hints only; clients still fetch content through permission-checked APIs.
-- Existing own_revision RLS continues to protect each user's notifications.
alter table public.branch_revisions add column if not exists change jsonb;
