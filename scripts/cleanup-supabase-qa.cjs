// Remove only fixtures recorded by verify-supabase-live.cjs. Dry run by default.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const cfg = require('../backend/config.cjs');
const file = 'backups/live-qa.json';

async function main() {
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(fixture.project, cfg.url, 'Fixture belongs to another project');
  if (fixture.cleanedAt) return console.log('QA fixtures already cleaned');
  assert(fixture.accounts.length > 0 && fixture.accounts.every(a => /^qa_[a-z0-9]+_(owner|editor)$/.test(a.username)));
  const authIds = fixture.accounts.map(a => a.session.user.id);
  const userIds = fixture.accounts.map(a => a.profile.id);
  const boardIds = fixture.boardIds;
  assert(fixture.storagePaths.every(p => boardIds.some(id => p.startsWith(id + '/'))));
  const db = new Client({ connectionString: cfg.database });
  const admin = createClient(cfg.url, cfg.secret, { auth: { persistSession: false, autoRefreshToken: false } });
  await db.connect();
  try {
    const boards = await db.query('select id,data from branch_private.records where id=any($1::text[])', [boardIds]);
    assert(boards.rows.every(b => userIds.includes(b.data.ownerId) && b.data.title.startsWith('Supabase migration QA')));
    const accounts = await db.query('select auth_id,user_id,username from branch_private.accounts where auth_id=any($1::uuid[])', [authIds]);
    assert(accounts.rows.every(a => fixture.accounts.some(f => f.username === a.username && f.profile.id === a.user_id && f.session.user.id === a.auth_id)));
    console.log(JSON.stringify({ qaAccounts: authIds.length, qaBoards: boardIds.length, qaFiles: fixture.storagePaths.length, apply: process.argv.includes('--apply') }));
    if (!process.argv.includes('--apply')) return;
    if (fixture.storagePaths.length) {
      const { error } = await admin.storage.from('branch-files').remove(fixture.storagePaths);
      if (error) throw error;
    }
    await db.query('begin');
    try {
      await db.query('select id from branch_private.runtime_lock where id=1 for update');
      await db.query("delete from branch_private.jobs where args->>'runId' in (select id from branch_private.records where collection='runs' and data->>'boardId'=any($1::text[]))", [boardIds]);
      await db.query('delete from branch_private.accounts where auth_id=any($1::uuid[])', [authIds]);
      await db.query('delete from public.branch_revisions where user_id=any($1::uuid[])', [authIds]);
      await db.query("delete from branch_private.records where id=any($1::text[]) or data->>'boardId'=any($2::text[]) or data->>'userId'=any($3::text[])", [[...boardIds, ...userIds, ...fixture.storagePaths.map(p => p.split('/').at(-1))], boardIds, userIds]);
      await db.query('commit');
    } catch (error) { await db.query('rollback'); throw error; }
    for (const id of authIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error && error.status !== 404) throw error;
    }
    fixture.cleanedAt = new Date().toISOString();
    fixture.accounts = fixture.accounts.map(a => ({ username: a.username, authId: a.session.user.id, userId: a.profile.id }));
    fs.writeFileSync(file, JSON.stringify(fixture, null, 2), { mode: 0o600 });
    console.log('Removed recorded QA fixtures and discarded temporary credentials.');
    console.log(JSON.stringify((await db.query('select collection,count(*)::int as count from branch_private.records group by collection order by collection')).rows));
  } finally { await db.end(); }
}
main().catch(error => { console.error('Cleanup failed:', error.message); process.exitCode = 1; });
