-- Add agent context to the existing relational schema.
begin;
set local lock_timeout = '15s';
select id from branch_private.runtime_lock where id=1 for update;

-- Earlier development builds applied the agent-context tables before GitHub.
do $agent_context$ begin
if to_regclass('branch_private.chatgpt_threads') is null then

create table branch_private."chatgpt_browser_grants" (
 id text primary key references branch_private.record_ids(id) deferrable initially deferred,
 created_at double precision not null check (created_at>=0 and created_at<'Infinity'::float8),
 "user_id" text not null,
 "board_id" text not null,
 "conversation_id" text not null,
 "key_hash" text not null
);
alter table branch_private."chatgpt_browser_grants" enable row level security;
create trigger register_record before insert or update on branch_private."chatgpt_browser_grants" for each row execute function branch_private.register_record('chatgptBrowserGrants');
create trigger unregister_record after delete on branch_private."chatgpt_browser_grants" for each row execute function branch_private.register_record('chatgptBrowserGrants');

create unique index "chatgpt_browser_grants_key_idx" on branch_private."chatgpt_browser_grants" ("key_hash");

create unique index "chatgpt_browser_grants_user_chat_idx" on branch_private."chatgpt_browser_grants" ("user_id","conversation_id");

create index "chatgpt_browser_grants_user_board_idx" on branch_private."chatgpt_browser_grants" ("user_id","board_id");

create table branch_private."chatgpt_threads" (
 id text primary key references branch_private.record_ids(id) deferrable initially deferred,
 created_at double precision not null check (created_at>=0 and created_at<'Infinity'::float8),
 "board_id" text not null,
 "user_id" text not null,
 "conversation_id" text not null,
 "node_key" text not null
);
alter table branch_private."chatgpt_threads" enable row level security;
create trigger register_record before insert or update on branch_private."chatgpt_threads" for each row execute function branch_private.register_record('chatgptThreads');
create trigger unregister_record after delete on branch_private."chatgpt_threads" for each row execute function branch_private.register_record('chatgptThreads');

create unique index "chatgpt_threads_conversation_idx" on branch_private."chatgpt_threads" ("board_id","user_id","conversation_id");

create unique index "chatgpt_threads_card_idx" on branch_private."chatgpt_threads" ("board_id","node_key");

create table branch_private."chatgpt_updates" (
 id text primary key references branch_private.record_ids(id) deferrable initially deferred,
 created_at double precision not null check (created_at>=0 and created_at<'Infinity'::float8),
 "thread_id" text not null,
 "update_id" text not null,
 "result" text not null
);
alter table branch_private."chatgpt_updates" enable row level security;
create trigger register_record before insert or update on branch_private."chatgpt_updates" for each row execute function branch_private.register_record('chatgptUpdates');
create trigger unregister_record after delete on branch_private."chatgpt_updates" for each row execute function branch_private.register_record('chatgptUpdates');

create unique index "chatgpt_updates_update_idx" on branch_private."chatgpt_updates" ("thread_id","update_id");

create table branch_private."coding_connections" (
 id text primary key references branch_private.record_ids(id) deferrable initially deferred,
 created_at double precision not null check (created_at>=0 and created_at<'Infinity'::float8),
 "board_id" text not null,
 "user_id" text not null,
 "key_hash" text not null
);
alter table branch_private."coding_connections" enable row level security;
create trigger register_record before insert or update on branch_private."coding_connections" for each row execute function branch_private.register_record('codingConnections');
create trigger unregister_record after delete on branch_private."coding_connections" for each row execute function branch_private.register_record('codingConnections');

create unique index "coding_connections_board_user_idx" on branch_private."coding_connections" ("board_id","user_id");

create unique index "coding_connections_key_idx" on branch_private."coding_connections" ("key_hash");

create table branch_private."coding_handoffs" (
 id text primary key references branch_private.record_ids(id) deferrable initially deferred,
 created_at double precision not null check (created_at>=0 and created_at<'Infinity'::float8),
 "board_id" text not null,
 "user_id" text not null,
 "node_id" text not null,
 "node_key" text not null,
 "expires_at" double precision not null check ("expires_at" > '-Infinity'::float8 and "expires_at" < 'Infinity'::float8),
 "one_time" boolean,
 "approval_hash" text,
 "result" text,
 "content" jsonb not null
);
alter table branch_private."coding_handoffs" enable row level security;
create trigger register_record before insert or update on branch_private."coding_handoffs" for each row execute function branch_private.register_record('codingHandoffs');
create trigger unregister_record after delete on branch_private."coding_handoffs" for each row execute function branch_private.register_record('codingHandoffs');

create index "coding_handoffs_board_user_idx" on branch_private."coding_handoffs" ("board_id","user_id");

create unique index "coding_handoffs_node_user_idx" on branch_private."coding_handoffs" ("node_id","user_id");

create unique index "coding_handoffs_approval_idx" on branch_private."coding_handoffs" ("approval_hash");

alter table branch_private."chatgpt_browser_grants" add constraint "chatgpt_browser_grants_user_id_fk" foreign key ("user_id") references branch_private."users"(id) deferrable initially deferred;

alter table branch_private."chatgpt_browser_grants" add constraint "chatgpt_browser_grants_board_id_fk" foreign key ("board_id") references branch_private."boards"(id) deferrable initially deferred;

alter table branch_private."chatgpt_threads" add constraint "chatgpt_threads_board_id_fk" foreign key ("board_id") references branch_private."boards"(id) deferrable initially deferred;

alter table branch_private."chatgpt_threads" add constraint "chatgpt_threads_user_id_fk" foreign key ("user_id") references branch_private."users"(id) deferrable initially deferred;

alter table branch_private."chatgpt_updates" add constraint "chatgpt_updates_thread_id_fk" foreign key ("thread_id") references branch_private."chatgpt_threads"(id) deferrable initially deferred;

alter table branch_private."coding_connections" add constraint "coding_connections_board_id_fk" foreign key ("board_id") references branch_private."boards"(id) deferrable initially deferred;

alter table branch_private."coding_connections" add constraint "coding_connections_user_id_fk" foreign key ("user_id") references branch_private."users"(id) deferrable initially deferred;

alter table branch_private."coding_handoffs" add constraint "coding_handoffs_board_id_fk" foreign key ("board_id") references branch_private."boards"(id) deferrable initially deferred;

alter table branch_private."coding_handoffs" add constraint "coding_handoffs_user_id_fk" foreign key ("user_id") references branch_private."users"(id) deferrable initially deferred;

alter table branch_private."coding_handoffs" add constraint "coding_handoffs_node_id_fk" foreign key ("node_id") references branch_private."nodes"(id) deferrable initially deferred;

alter table branch_private.nodes add column "chatgpt_synced" boolean;

alter table branch_private.nodes add column "chatgpt_latest_update" double precision;

alter table branch_private.nodes add column "coding_note" jsonb;

alter table branch_private.nodes add column "coding_result" jsonb;

create index chatgpt_updates_timeline_idx on branch_private.chatgpt_updates (thread_id, created_at desc, id desc);

end if;
end $agent_context$;

-- Compatibility view keeps the proven handler/transaction API stable.
-- These are dedicated tables with typed columns, not views over a JSON records table.
create or replace view branch_private.records with (security_invoker=true) as
select id,'chatgptBrowserGrants'::text as collection,created_at,(jsonb_build_object('userId',"user_id") || jsonb_build_object('boardId',"board_id") || jsonb_build_object('conversationId',"conversation_id") || jsonb_build_object('keyHash',"key_hash")) as data from branch_private."chatgpt_browser_grants"
union all
select id,'chatgptThreads'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('userId',"user_id") || jsonb_build_object('conversationId',"conversation_id") || jsonb_build_object('nodeKey',"node_key")) as data from branch_private."chatgpt_threads"
union all
select id,'chatgptUpdates'::text as collection,created_at,(jsonb_build_object('threadId',"thread_id") || jsonb_build_object('updateId',"update_id") || jsonb_build_object('result',"result")) as data from branch_private."chatgpt_updates"
union all
select id,'codingConnections'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('userId',"user_id") || jsonb_build_object('keyHash',"key_hash")) as data from branch_private."coding_connections"
union all
select id,'codingHandoffs'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('userId',"user_id") || jsonb_build_object('nodeId',"node_id") || jsonb_build_object('nodeKey',"node_key") || jsonb_build_object('expiresAt',"expires_at") || case when "one_time" is null then '{}'::jsonb else jsonb_build_object('oneTime',"one_time") end || case when "approval_hash" is null then '{}'::jsonb else jsonb_build_object('approvalHash',"approval_hash") end || case when "result" is null then '{}'::jsonb else jsonb_build_object('result',"result") end || jsonb_build_object('content',"content")) as data from branch_private."coding_handoffs"
union all
select id,'uploadTickets'::text as collection,created_at,(jsonb_build_object('fileTicket',"file_ticket") || jsonb_build_object('boardId',"board_id") || jsonb_build_object('userId',"user_id") || jsonb_build_object('hash',"hash") || jsonb_build_object('expiresAt',"expires_at") || jsonb_build_object('used',"used")) as data from branch_private."upload_tickets"
union all
select id,'chatgptConnections'::text as collection,created_at,(jsonb_build_object('userId',"user_id") || jsonb_build_object('ciphertext',"ciphertext") || jsonb_build_object('subject',"subject") || jsonb_build_object('clientId',"client_id") || jsonb_build_object('label',"label") || jsonb_build_object('models',"models") || jsonb_build_object('selectedModel',"selected_model") || jsonb_build_object('expiresAt',"expires_at") || jsonb_build_object('revision',"revision") || case when "refresh_lease" is null then '{}'::jsonb else jsonb_build_object('refreshLease',"refresh_lease") end || case when "refresh_until" is null then '{}'::jsonb else jsonb_build_object('refreshUntil',"refresh_until") end) as data from branch_private."chatgpt_connections"
union all
select id,'chatgptTransactions'::text as collection,created_at,(jsonb_build_object('userId',"user_id") || case when "consumed" is null then '{}'::jsonb else jsonb_build_object('consumed',"consumed") end || jsonb_build_object('stateHash',"state_hash") || jsonb_build_object('browserHash',"browser_hash") || jsonb_build_object('ciphertext',"ciphertext") || jsonb_build_object('expiresAt',"expires_at") || case when "connection_id" is null then '{}'::jsonb else jsonb_build_object('connectionId',"connection_id") end) as data from branch_private."chatgpt_transactions"
union all
select id,'workspaceKeys'::text as collection,created_at,(jsonb_build_object('scope',"scope") || jsonb_build_object('ciphertext',"ciphertext") || jsonb_build_object('suffix',"suffix")) as data from branch_private."workspace_keys"
union all
select id,'fileUploads'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('userId',"user_id") || case when "storage_id" is null then '{}'::jsonb else jsonb_build_object('storageId',"storage_id") end) as data from branch_private."file_uploads"
union all
select id,'users'::text as collection,created_at,(case when "identity_key" is null then '{}'::jsonb else jsonb_build_object('identityKey',"identity_key") end || jsonb_build_object('name',"name") || case when "color" is null then '{}'::jsonb else jsonb_build_object('color',"color") end || case when "background" is null then '{}'::jsonb else jsonb_build_object('background',"background") end || jsonb_build_object('kind',"kind")) as data from branch_private."users"
union all
select id,'teams'::text as collection,created_at,(jsonb_build_object('name',"name") || case when "description" is null then '{}'::jsonb else jsonb_build_object('description',"description") end || jsonb_build_object('ownerId',"owner_id")) as data from branch_private."teams"
union all
select id,'teamMembers'::text as collection,created_at,(jsonb_build_object('teamId',"team_id") || jsonb_build_object('userId',"user_id") || jsonb_build_object('role',"role") || case when "responsibility" is null then '{}'::jsonb else jsonb_build_object('responsibility',"responsibility") end) as data from branch_private."team_members"
union all
select id,'teamInvites'::text as collection,created_at,(jsonb_build_object('teamId',"team_id") || jsonb_build_object('tokenHash',"token_hash") || jsonb_build_object('invitedBy',"invited_by") || jsonb_build_object('role',"role") || jsonb_build_object('expiresAt',"expires_at") || case when "accepted_by" is null then '{}'::jsonb else jsonb_build_object('acceptedBy',"accepted_by") end) as data from branch_private."team_invites"
union all
select id,'boards'::text as collection,created_at,(case when "project_plan" is null then '{}'::jsonb else jsonb_build_object('projectPlan',"project_plan") end || case when "project_version" is null then '{}'::jsonb else jsonb_build_object('projectVersion',"project_version") end || case when "repository" is null then '{}'::jsonb else jsonb_build_object('repository',"repository") end || jsonb_build_object('title',"title") || jsonb_build_object('ownerId',"owner_id") || case when "team_id" is null then '{}'::jsonb else jsonb_build_object('teamId',"team_id") end || jsonb_build_object('development',"development") || jsonb_build_object('initialized',"initialized") || case when "updated_at" is null then '{}'::jsonb else jsonb_build_object('updatedAt',"updated_at") end || case when "archived" is null then '{}'::jsonb else jsonb_build_object('archived',"archived") end) as data from branch_private."boards"
union all
select id,'boardMembers'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('userId',"user_id") || jsonb_build_object('role',"role") || case when "responsibility" is null then '{}'::jsonb else jsonb_build_object('responsibility',"responsibility") end) as data from branch_private."board_members"
union all
select id,'projectResponsibilities'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('userId',"user_id") || jsonb_build_object('responsibility',"responsibility")) as data from branch_private."project_responsibilities"
union all
select id,'sessions'::text as collection,created_at,(jsonb_build_object('tokenHash',"token_hash") || jsonb_build_object('userId',"user_id") || jsonb_build_object('expiresAt',"expires_at")) as data from branch_private."sessions"
union all
select id,'nodes'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('key',"key") || jsonb_build_object('data',"data") || jsonb_build_object('textState',"text_state") || jsonb_build_object('textVersion',"text_version") || jsonb_build_object('createdBy',"created_by") || jsonb_build_object('updatedBy',"updated_by") || jsonb_build_object('deleted',"deleted") || case when "chatgpt_synced" is null then '{}'::jsonb else jsonb_build_object('chatgptSynced',"chatgpt_synced") end || case when "chatgpt_latest_update" is null then '{}'::jsonb else jsonb_build_object('chatgptLatestUpdate',"chatgpt_latest_update") end || case when "coding_note" is null then '{}'::jsonb else jsonb_build_object('codingNote',"coding_note") end || case when "coding_result" is null then '{}'::jsonb else jsonb_build_object('codingResult',"coding_result") end || case when "deletion" is null then '{}'::jsonb else jsonb_build_object('deletion',"deletion") end) as data from branch_private."nodes"
union all
select id,'boardPresence'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('userId',"user_id") || jsonb_build_object('tabId',"tab_id") || jsonb_build_object('expiresAt',"expires_at")) as data from branch_private."board_presence"
union all
select id,'cursors'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('userId',"user_id") || jsonb_build_object('tabId',"tab_id") || jsonb_build_object('x',"x") || jsonb_build_object('y',"y") || jsonb_build_object('expiresAt',"expires_at")) as data from branch_private."cursors"
union all
select id,'editors'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('nodeKey',"node_key") || jsonb_build_object('field',"field") || jsonb_build_object('tabId',"tab_id") || jsonb_build_object('userId',"user_id") || jsonb_build_object('expiresAt',"expires_at")) as data from branch_private."editors"
union all
select id,'runs'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('nodeKey',"node_key") || jsonb_build_object('status',"status") || jsonb_build_object('initiatedBy',"initiated_by") || jsonb_build_object('billedUserId',"billed_user_id") || jsonb_build_object('model',"model") || case when "provider" is null then '{}'::jsonb else jsonb_build_object('provider',"provider") end || case when "connection_id" is null then '{}'::jsonb else jsonb_build_object('connectionId',"connection_id") end || case when "provider_user_id" is null then '{}'::jsonb else jsonb_build_object('providerUserId',"provider_user_id") end || jsonb_build_object('requestId',"request_id") || jsonb_build_object('input',"input") || jsonb_build_object('assistantId',"assistant_id") || case when "checkpoint" is null then '{}'::jsonb else jsonb_build_object('checkpoint',"checkpoint") end || case when "error" is null then '{}'::jsonb else jsonb_build_object('error',"error") end || case when "usage" is null then '{}'::jsonb else jsonb_build_object('usage',"usage") end || jsonb_build_object('createdAt',"run_created_at")) as data from branch_private."runs"
union all
select id,'boardLinks'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('tokenHash',"token_hash") || jsonb_build_object('role',"role") || case when "expires_at" is null then '{}'::jsonb else jsonb_build_object('expiresAt',"expires_at") end || jsonb_build_object('revoked',"revoked") || case when "label" is null then '{}'::jsonb else jsonb_build_object('label',"label") end || case when "last_guest_at" is null then '{}'::jsonb else jsonb_build_object('lastGuestAt',"last_guest_at") end) as data from branch_private."board_links"
union all
select id,'linkMembers'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('linkId',"link_id") || jsonb_build_object('userId',"user_id")) as data from branch_private."link_members"
union all
select id,'githubConnections'::text as collection,created_at,(jsonb_build_object('userId',"user_id") || jsonb_build_object('githubId',"github_id") || jsonb_build_object('login',"login") || jsonb_build_object('avatarUrl',"avatar_url") || jsonb_build_object('repos',"repos") || jsonb_build_object('updatedAt',"updated_at")) as data from branch_private."github_connections"
union all
select id,'boardRepos'::text as collection,created_at,(jsonb_build_object('boardId',"board_id") || jsonb_build_object('repoId',"repo_id") || jsonb_build_object('fullName',"full_name") || jsonb_build_object('private',"private") || jsonb_build_object('defaultBranch',"default_branch") || jsonb_build_object('installationId',"installation_id") || jsonb_build_object('addedBy',"added_by") || jsonb_build_object('createdAt',"run_created_at")) as data from branch_private."board_repos"
union all
select id,'creditLedger'::text as collection,created_at,(jsonb_build_object('ownerId',"owner_id") || jsonb_build_object('boardId',"board_id") || jsonb_build_object('runId',"run_id") || jsonb_build_object('amount',"amount") || jsonb_build_object('kind',"kind")) as data from branch_private."credit_ledger"
union all
select id,'_storage'::text as collection,created_at,(jsonb_build_object('path',"path") || jsonb_build_object('size',"size") || case when "content_type" is null then '{}'::jsonb else jsonb_build_object('contentType',"content_type") end || case when "ticket" is null then '{}'::jsonb else jsonb_build_object('ticket',"ticket") end || case when "board_id" is null then '{}'::jsonb else jsonb_build_object('boardId',"board_id") end || case when "user_id" is null then '{}'::jsonb else jsonb_build_object('userId',"user_id") end) as data from branch_private."files";

create or replace function branch_private.write_record() returns trigger language plpgsql set search_path=pg_catalog,branch_private as $$
declare target text; columns_sql text; values_sql text; allowed text[];
begin
 if TG_OP='DELETE' then
  select case old.collection when 'chatgptBrowserGrants' then 'chatgpt_browser_grants' when 'chatgptThreads' then 'chatgpt_threads' when 'chatgptUpdates' then 'chatgpt_updates' when 'codingConnections' then 'coding_connections' when 'codingHandoffs' then 'coding_handoffs' when 'uploadTickets' then 'upload_tickets' when 'chatgptConnections' then 'chatgpt_connections' when 'chatgptTransactions' then 'chatgpt_transactions' when 'workspaceKeys' then 'workspace_keys' when 'fileUploads' then 'file_uploads' when 'users' then 'users' when 'teams' then 'teams' when 'teamMembers' then 'team_members' when 'teamInvites' then 'team_invites' when 'boards' then 'boards' when 'boardMembers' then 'board_members' when 'projectResponsibilities' then 'project_responsibilities' when 'sessions' then 'sessions' when 'nodes' then 'nodes' when 'boardPresence' then 'board_presence' when 'cursors' then 'cursors' when 'editors' then 'editors' when 'runs' then 'runs' when 'boardLinks' then 'board_links' when 'linkMembers' then 'link_members' when 'githubConnections' then 'github_connections' when 'boardRepos' then 'board_repos' when 'creditLedger' then 'credit_ledger' when '_storage' then 'files' end into target;
  execute format('delete from branch_private.%I where id=$1',target) using old.id;
  return old;
 end if;
 if TG_OP='UPDATE' and (new.id is distinct from old.id or new.collection is distinct from old.collection or new.created_at is distinct from old.created_at) then raise exception 'Immutable record identity'; end if;
 if jsonb_typeof(new.data) is distinct from 'object' then raise exception 'Record must be an object'; end if;
 case new.collection
 when 'chatgptBrowserGrants' then target:='chatgpt_browser_grants'; allowed:=array['userId','boardId','conversationId','keyHash']; columns_sql:='"user_id","board_id","conversation_id","key_hash"'; values_sql:='($1->>''userId'')::text,($1->>''boardId'')::text,($1->>''conversationId'')::text,($1->>''keyHash'')::text';
when 'chatgptThreads' then target:='chatgpt_threads'; allowed:=array['boardId','userId','conversationId','nodeKey']; columns_sql:='"board_id","user_id","conversation_id","node_key"'; values_sql:='($1->>''boardId'')::text,($1->>''userId'')::text,($1->>''conversationId'')::text,($1->>''nodeKey'')::text';
when 'chatgptUpdates' then target:='chatgpt_updates'; allowed:=array['threadId','updateId','result']; columns_sql:='"thread_id","update_id","result"'; values_sql:='($1->>''threadId'')::text,($1->>''updateId'')::text,($1->>''result'')::text';
when 'codingConnections' then target:='coding_connections'; allowed:=array['boardId','userId','keyHash']; columns_sql:='"board_id","user_id","key_hash"'; values_sql:='($1->>''boardId'')::text,($1->>''userId'')::text,($1->>''keyHash'')::text';
when 'codingHandoffs' then target:='coding_handoffs'; allowed:=array['boardId','userId','nodeId','nodeKey','expiresAt','oneTime','approvalHash','result','content']; columns_sql:='"board_id","user_id","node_id","node_key","expires_at","one_time","approval_hash","result","content"'; values_sql:='($1->>''boardId'')::text,($1->>''userId'')::text,($1->>''nodeId'')::text,($1->>''nodeKey'')::text,($1->>''expiresAt'')::double precision,($1->>''oneTime'')::boolean,($1->>''approvalHash'')::text,($1->>''result'')::text,$1->''content''';
when 'uploadTickets' then target:='upload_tickets'; allowed:=array['fileTicket','boardId','userId','hash','expiresAt','used']; columns_sql:='"file_ticket","board_id","user_id","hash","expires_at","used"'; values_sql:='($1->>''fileTicket'')::text,($1->>''boardId'')::text,($1->>''userId'')::text,($1->>''hash'')::text,($1->>''expiresAt'')::double precision,($1->>''used'')::boolean';
when 'chatgptConnections' then target:='chatgpt_connections'; allowed:=array['userId','ciphertext','subject','clientId','label','models','selectedModel','expiresAt','revision','refreshLease','refreshUntil']; columns_sql:='"user_id","ciphertext","subject","client_id","label","models","selected_model","expires_at","revision","refresh_lease","refresh_until"'; values_sql:='($1->>''userId'')::text,($1->>''ciphertext'')::text,($1->>''subject'')::text,($1->>''clientId'')::text,($1->>''label'')::text,$1->''models'',($1->>''selectedModel'')::text,($1->>''expiresAt'')::double precision,($1->>''revision'')::double precision,($1->>''refreshLease'')::text,($1->>''refreshUntil'')::double precision';
when 'chatgptTransactions' then target:='chatgpt_transactions'; allowed:=array['userId','consumed','stateHash','browserHash','ciphertext','expiresAt','connectionId']; columns_sql:='"user_id","consumed","state_hash","browser_hash","ciphertext","expires_at","connection_id"'; values_sql:='($1->>''userId'')::text,($1->>''consumed'')::boolean,($1->>''stateHash'')::text,($1->>''browserHash'')::text,($1->>''ciphertext'')::text,($1->>''expiresAt'')::double precision,($1->>''connectionId'')::text';
when 'workspaceKeys' then target:='workspace_keys'; allowed:=array['scope','ciphertext','suffix']; columns_sql:='"scope","ciphertext","suffix"'; values_sql:='($1->>''scope'')::text,($1->>''ciphertext'')::text,($1->>''suffix'')::text';
when 'fileUploads' then target:='file_uploads'; allowed:=array['boardId','userId','storageId']; columns_sql:='"board_id","user_id","storage_id"'; values_sql:='($1->>''boardId'')::text,($1->>''userId'')::text,($1->>''storageId'')::text';
when 'users' then target:='users'; allowed:=array['identityKey','name','color','background','kind']; columns_sql:='"identity_key","name","color","background","kind"'; values_sql:='($1->>''identityKey'')::text,($1->>''name'')::text,($1->>''color'')::text,($1->>''background'')::text,($1->>''kind'')::text';
when 'teams' then target:='teams'; allowed:=array['name','description','ownerId']; columns_sql:='"name","description","owner_id"'; values_sql:='($1->>''name'')::text,($1->>''description'')::text,($1->>''ownerId'')::text';
when 'teamMembers' then target:='team_members'; allowed:=array['teamId','userId','role','responsibility']; columns_sql:='"team_id","user_id","role","responsibility"'; values_sql:='($1->>''teamId'')::text,($1->>''userId'')::text,($1->>''role'')::text,($1->>''responsibility'')::text';
when 'teamInvites' then target:='team_invites'; allowed:=array['teamId','tokenHash','invitedBy','role','expiresAt','acceptedBy']; columns_sql:='"team_id","token_hash","invited_by","role","expires_at","accepted_by"'; values_sql:='($1->>''teamId'')::text,($1->>''tokenHash'')::text,($1->>''invitedBy'')::text,($1->>''role'')::text,($1->>''expiresAt'')::double precision,($1->>''acceptedBy'')::text';
when 'boards' then target:='boards'; allowed:=array['projectPlan','projectVersion','repository','title','ownerId','teamId','development','initialized','updatedAt','archived']; columns_sql:='"project_plan","project_version","repository","title","owner_id","team_id","development","initialized","updated_at","archived"'; values_sql:='$1->''projectPlan'',($1->>''projectVersion'')::double precision,($1->>''repository'')::text,($1->>''title'')::text,($1->>''ownerId'')::text,($1->>''teamId'')::text,($1->>''development'')::boolean,($1->>''initialized'')::boolean,($1->>''updatedAt'')::double precision,($1->>''archived'')::boolean';
when 'boardMembers' then target:='board_members'; allowed:=array['boardId','userId','role','responsibility']; columns_sql:='"board_id","user_id","role","responsibility"'; values_sql:='($1->>''boardId'')::text,($1->>''userId'')::text,($1->>''role'')::text,($1->>''responsibility'')::text';
when 'projectResponsibilities' then target:='project_responsibilities'; allowed:=array['boardId','userId','responsibility']; columns_sql:='"board_id","user_id","responsibility"'; values_sql:='($1->>''boardId'')::text,($1->>''userId'')::text,($1->>''responsibility'')::text';
when 'sessions' then target:='sessions'; allowed:=array['tokenHash','userId','expiresAt']; columns_sql:='"token_hash","user_id","expires_at"'; values_sql:='($1->>''tokenHash'')::text,($1->>''userId'')::text,($1->>''expiresAt'')::double precision';
when 'nodes' then target:='nodes'; allowed:=array['boardId','key','data','textState','textVersion','createdBy','updatedBy','deleted','chatgptSynced','chatgptLatestUpdate','codingNote','codingResult','deletion']; columns_sql:='"board_id","key","data","text_state","text_version","created_by","updated_by","deleted","chatgpt_synced","chatgpt_latest_update","coding_note","coding_result","deletion"'; values_sql:='($1->>''boardId'')::text,($1->>''key'')::text,$1->''data'',$1->''textState'',($1->>''textVersion'')::double precision,($1->>''createdBy'')::text,($1->>''updatedBy'')::text,($1->>''deleted'')::boolean,($1->>''chatgptSynced'')::boolean,($1->>''chatgptLatestUpdate'')::double precision,$1->''codingNote'',$1->''codingResult'',$1->''deletion''';
when 'boardPresence' then target:='board_presence'; allowed:=array['boardId','userId','tabId','expiresAt']; columns_sql:='"board_id","user_id","tab_id","expires_at"'; values_sql:='($1->>''boardId'')::text,($1->>''userId'')::text,($1->>''tabId'')::text,($1->>''expiresAt'')::double precision';
when 'cursors' then target:='cursors'; allowed:=array['boardId','userId','tabId','x','y','expiresAt']; columns_sql:='"board_id","user_id","tab_id","x","y","expires_at"'; values_sql:='($1->>''boardId'')::text,($1->>''userId'')::text,($1->>''tabId'')::text,($1->>''x'')::double precision,($1->>''y'')::double precision,($1->>''expiresAt'')::double precision';
when 'editors' then target:='editors'; allowed:=array['boardId','nodeKey','field','tabId','userId','expiresAt']; columns_sql:='"board_id","node_key","field","tab_id","user_id","expires_at"'; values_sql:='($1->>''boardId'')::text,($1->>''nodeKey'')::text,($1->>''field'')::text,($1->>''tabId'')::text,($1->>''userId'')::text,($1->>''expiresAt'')::double precision';
when 'runs' then target:='runs'; allowed:=array['boardId','nodeKey','status','initiatedBy','billedUserId','model','provider','connectionId','providerUserId','requestId','input','assistantId','checkpoint','error','usage','createdAt']; columns_sql:='"board_id","node_key","status","initiated_by","billed_user_id","model","provider","connection_id","provider_user_id","request_id","input","assistant_id","checkpoint","error","usage","run_created_at"'; values_sql:='($1->>''boardId'')::text,($1->>''nodeKey'')::text,($1->>''status'')::text,($1->>''initiatedBy'')::text,($1->>''billedUserId'')::text,($1->>''model'')::text,($1->>''provider'')::text,($1->>''connectionId'')::text,($1->>''providerUserId'')::text,($1->>''requestId'')::text,$1->''input'',($1->>''assistantId'')::text,$1->''checkpoint'',($1->>''error'')::text,$1->''usage'',($1->>''createdAt'')::double precision';
when 'boardLinks' then target:='board_links'; allowed:=array['boardId','tokenHash','role','expiresAt','revoked','label','lastGuestAt']; columns_sql:='"board_id","token_hash","role","expires_at","revoked","label","last_guest_at"'; values_sql:='($1->>''boardId'')::text,($1->>''tokenHash'')::text,($1->>''role'')::text,($1->>''expiresAt'')::double precision,($1->>''revoked'')::boolean,($1->>''label'')::text,($1->>''lastGuestAt'')::double precision';
when 'linkMembers' then target:='link_members'; allowed:=array['boardId','linkId','userId']; columns_sql:='"board_id","link_id","user_id"'; values_sql:='($1->>''boardId'')::text,($1->>''linkId'')::text,($1->>''userId'')::text';
when 'githubConnections' then target:='github_connections'; allowed:=array['userId','githubId','login','avatarUrl','repos','updatedAt']; columns_sql:='"user_id","github_id","login","avatar_url","repos","updated_at"'; values_sql:='($1->>''userId'')::text,($1->>''githubId'')::text,($1->>''login'')::text,($1->>''avatarUrl'')::text,$1->''repos'',($1->>''updatedAt'')::double precision';
when 'boardRepos' then target:='board_repos'; allowed:=array['boardId','repoId','fullName','private','defaultBranch','installationId','addedBy','createdAt']; columns_sql:='"board_id","repo_id","full_name","private","default_branch","installation_id","added_by","run_created_at"'; values_sql:='($1->>''boardId'')::text,($1->>''repoId'')::double precision,($1->>''fullName'')::text,($1->>''private'')::boolean,($1->>''defaultBranch'')::text,($1->>''installationId'')::double precision,($1->>''addedBy'')::text,($1->>''createdAt'')::double precision';
when 'creditLedger' then target:='credit_ledger'; allowed:=array['ownerId','boardId','runId','amount','kind']; columns_sql:='"owner_id","board_id","run_id","amount","kind"'; values_sql:='($1->>''ownerId'')::text,($1->>''boardId'')::text,($1->>''runId'')::text,($1->>''amount'')::double precision,($1->>''kind'')::text';
when '_storage' then target:='files'; allowed:=array['path','size','contentType','ticket','boardId','userId']; columns_sql:='"path","size","content_type","ticket","board_id","user_id"'; values_sql:='($1->>''path'')::text,($1->>''size'')::double precision,($1->>''contentType'')::text,($1->>''ticket'')::text,($1->>''boardId'')::text,($1->>''userId'')::text';
 else raise exception 'Unknown collection';
 end case;
 if exists(select 1 from jsonb_object_keys(new.data) k where not k=any(allowed)) then raise exception 'Unknown record field'; end if;
 if TG_OP='INSERT' then
  execute format('insert into branch_private.%I (id,created_at,%s) select $2,$3,%s',target,columns_sql,values_sql) using new.data,new.id,new.created_at;
 else
  -- Delete/reinsert would break references and trigger identity registration.
  execute format('update branch_private.%I set (%s)=(select %s) where id=$2',target,columns_sql,values_sql) using new.data,old.id;
 end if;
 return new;
end $$;
revoke all on all tables in schema branch_private from public,anon,authenticated;
revoke all on all functions in schema branch_private from public,anon,authenticated;
set constraints all immediate;
commit;
