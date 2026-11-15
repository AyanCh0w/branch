// Add a disjoint Convex snapshot to an existing Supabase project. Never overwrite.
// Default: validate local data and roll back a real SQL constraint rehearsal.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {Client} = require('pg');
const {createClient} = require('@supabase/supabase-js');
const config = require('../backend/config.cjs');
const schema = require('../backend/schema.bundle.cjs').default;
const ephemeral = new Set(['sessions', 'editors', 'cursors', 'boardPresence', 'chatgptTransactions']);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function convert(value, validation = false) {
  if (Array.isArray(value)) return value.map(v => convert(v, validation));
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && value.$bytes !== undefined) {
    return validation ? Uint8Array.from(Buffer.from(value.$bytes, 'base64')).buffer : {$branch:'bytes', value:value.$bytes};
  }
  if ('$integer' in value || '$float' in value) throw Error('Unsupported exported numeric encoding');
  return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,convert(v, validation)]));
}
function snapshot(root, {preserveMissingUsers=false} = {}) {
  const read = name => {
    const file = path.join(root, name, 'documents.jsonl');
    return fs.existsSync(file) ? fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  };
  const collections = fs.readdirSync(root,{withFileTypes:true}).filter(e => e.isDirectory() && !e.name.startsWith('_')).map(e => e.name).sort();
  const records = [], ids = new Map(), refs = [];
  for (const collection of collections) {
    if (!schema[collection]) throw Error('Unknown source collection: '+collection);
    for (const row of read(collection)) {
      const {_id,_creationTime,...raw} = row;
      if (ids.has(_id)) throw Error('Duplicate source identity');
      ids.set(_id, collection);
      schema[collection].validator.parse(convert(raw,true));
      if (ephemeral.has(collection)) continue;
      refs.push(...schema[collection].validator.references(convert(raw,true)));
      const data = convert(raw);
      if (collection === 'runs' && ['queued','streaming'].includes(data.status)) {
        data.status = 'failed'; data.error = 'Interrupted by backend migration; retry after signing in.';
      }
      if (collection === 'nodes' && data.data?.activeRun) {
        delete data.data.activeRun; delete data.data.activity;
      }
      records.push({id:_id,collection,created_at:_creationTime,data});
    }
  }
  // Encrypted connections need separate key migration; do not copy unusable tokens.
  if (read('chatgptConnections').length || read('workspaceKeys').length) throw Error('Provider encryption keys require a separately verified migration');
  const storageNames = fs.existsSync(path.join(root,'_storage')) ? fs.readdirSync(path.join(root,'_storage')) : [];
  const files = read('_storage').map(f => {
    if (ids.has(f._id)) throw Error('Storage identity collision');
    ids.set(f._id,'_storage');
    const tickets = read('fileUploads').filter(t => t.storageId === f._id);
    if (tickets.length !== 1) throw Error('Storage object has no unique board registration');
    const ticket = tickets[0];
    const matches = storageNames.filter(n => n === f._id || n.startsWith(f._id+'.'));
    if (matches.length !== 1) throw Error('Missing or ambiguous snapshot storage file');
    const filename = path.join(root,'_storage',matches[0]), bytes = fs.readFileSync(filename);
    const sha256 = hash(bytes);
    if (bytes.length !== f.size || sha256 !== Buffer.from(f.sha256,'base64').toString('hex')) throw Error('Snapshot file checksum mismatch');
    const objectPath = ticket.boardId+'/'+f._id;
    records.push({id:f._id,collection:'_storage',created_at:f._creationTime,data:{path:objectPath,size:f.size,contentType:f.contentType,boardId:ticket.boardId,userId:ticket.userId,ticket:ticket._id}});
    return {id:f._id,filename,objectPath,sha256,size:f.size,contentType:f.contentType};
  });
  const missingUsers = [...new Set(refs.filter(r=>r.table==='users'&&!ids.has(r.id)).map(r=>r.id))].sort();
  if (missingUsers.length && preserveMissingUsers) {
    // Tombstones have no identity key, credentials, account mapping or sessions.
    // Preserve original references without assigning their access to someone else.
    for (const id of missingUsers) {
      ids.set(id,'users');
      records.push({id,collection:'users',created_at:0,data:{name:'Unavailable user (migrated history)',kind:'guest'}});
    }
  }
  for (const ref of refs) {
    // Completed runs can retain IDs of subsequently disconnected providers.
    if (ref.table === 'chatgptConnections' && !ids.has(ref.id)) continue;
    if (ids.get(ref.id) !== ref.table) throw Error('Missing or inconsistent source reference: '+ref.table);
  }
  const names = read('_components/authUsername/usernames'), passwords = read('_components/authPassword/passwords');
  const accounts = read('users').filter(u => u.kind === 'account').map(u => {
    const n = names.filter(n => n.userId === u._id), p = passwords.filter(p => p.userId === u._id);
    if (n.length !== 1 || p.length !== 1 || !/^\$(argon2(id|i)|2[aby])\$/.test(p[0].passwordHashPHC)) throw Error('Missing or unsupported account hash');
    const username = n[0].usernameNormalized || n[0].username.toLowerCase();
    return {userId:u._id,username,passwordHash:p[0].passwordHashPHC,email:hash(username)+'@accounts.branch.invalid'};
  });
  if (new Set(accounts.map(a=>a.username)).size !== accounts.length) throw Error('Duplicate source username');
  return {records,accounts,files,missingUsers,fingerprint:hash(JSON.stringify({records,accounts,files:files.map(({filename,...f})=>f)})),skipped:Object.fromEntries([...ephemeral].map(c=>[c,read(c).length]))};
}
async function insertRecords(db, records) {
  for (let offset=0;offset<records.length;offset+=100) {
    const chunk=records.slice(offset,offset+100),params=[];
    const tuples=chunk.map((r,i)=>{params.push(r.id,r.collection,r.created_at,JSON.stringify(r.data));return `($${i*4+1},$${i*4+2},$${i*4+3}::double precision,$${i*4+4}::jsonb)`;});
    await db.query('insert into branch_private.records(id,collection,created_at,data) values '+tuples.join(','),params);
  }
}
async function checkDestination(db, source) {
  const collision = await db.query('select id from branch_private.record_ids where id=any($1::text[])',[source.records.map(r=>r.id)]);
  if (collision.rowCount) throw Error('Destination contains source IDs; refuse overwrite or repeated import');
  const accounts = await db.query('select username from branch_private.accounts where username=any($1::text[])',[source.accounts.map(a=>a.username)]);
  if (accounts.rowCount) throw Error('Existing usernames require explicit identity reconciliation');
}
async function verifyRecords(db, records) {
  const rows = (await db.query('select * from branch_private.records where id=any($1::text[])',[records.map(r=>r.id)])).rows;
  const found = new Map(rows.map(r=>[r.id,r]));
  for (const r of records) {
    const actual=found.get(r.id); if(!actual)throw Error('Imported row missing');
    const normalized={id:actual.id,collection:actual.collection,created_at:Number(actual.created_at),data:actual.data};
    try {assert.deepEqual(normalized,r);} catch {
      const diff=(a,b,p='')=>{
        if(a&&b&&typeof a==='object'&&typeof b==='object')return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diff(a[k],b[k],p+'.'+k));
        return Object.is(a,b)?[]:[p];
      };
      throw Error('Record round-trip mismatch in '+r.collection+' at '+diff(normalized,r).slice(0,8).join(', '));
    }
  }
}
async function main() {
  const root = path.resolve(process.argv[2] || 'backups/convex-live-20261113');
  const apply = process.argv.includes('--apply'), source = snapshot(root,{preserveMissingUsers:process.argv.includes('--preserve-missing-users')});
  console.log(JSON.stringify({mode:apply?'apply':'rehearsal',accounts:source.accounts.length,files:source.files.length,historyOnlyUserPlaceholders:source.missingUsers.length,records:source.records.reduce((a,r)=>(a[r.collection]=(a[r.collection]||0)+1,a),{}),excludedEphemeral:source.skipped}));
  const manifestFile = path.join(root,'supabase-append-manifest.json');
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile,'utf8')) : {project:config.url,fingerprint:source.fingerprint,accounts:{},files:{},complete:false};
  if (manifest.project!==config.url || manifest.fingerprint!==source.fingerprint) throw Error('Snapshot or destination changed');
  if (manifest.complete) throw Error('Snapshot already imported; refusing to repeat');
  const save = () => {fs.writeFileSync(manifestFile+'.tmp',JSON.stringify(manifest,null,2),{mode:0o600});fs.renameSync(manifestFile+'.tmp',manifestFile);};
  const db = new Client({connectionString:config.database});
  await db.connect();
  try {
    // Pooler defaults may round fractional Convex timestamps during text output.
    await db.query('set extra_float_digits = 3');
    // A full rollback rehearsal validates all unique, typed, CHECK and FK constraints.
    await db.query('begin');
    try {
      await db.query("set local lock_timeout='15s'");
      await db.query('select id from branch_private.runtime_lock where id=1 for update');
      await checkDestination(db,source);
      await insertRecords(db,source.records);
      await db.query('set constraints all immediate');
      await verifyRecords(db,source.records);
    } finally {await db.query('rollback');}
    console.log('All record constraints and round-trip equality passed in a rolled-back transaction.');
    if (!apply) return;
    if (!manifest.backup) {
      await db.query('begin isolation level repeatable read read only');
      const backup={at:new Date().toISOString(),project:config.url};
      for(const table of ['records','accounts','jobs'])backup[table]=(await db.query('select * from branch_private.'+table)).rows;
      backup.revisions=(await db.query('select * from public.branch_revisions')).rows;
      backup.authUsers=(await db.query('select id,email,encrypted_password,raw_user_meta_data from auth.users')).rows;
      await db.query('commit');
      manifest.backup=path.join(root,'destination-before-append.json');
      fs.writeFileSync(manifest.backup,JSON.stringify(backup),{mode:0o600,flag:'wx'});save();
    }
    const admin=createClient(config.url,config.secret,{auth:{persistSession:false,autoRefreshToken:false}});
    for(const a of source.accounts) {
      let existing=(await db.query('select id,encrypted_password,raw_user_meta_data from auth.users where email=$1',[a.email])).rows[0];
      if (!existing) {
        const {data,error}=await admin.auth.admin.createUser({email:a.email,email_confirm:true,password_hash:a.passwordHash,user_metadata:{branchConvexImport:source.fingerprint,convexUserId:a.userId}});
        if(error||!data.user)throw Error('Auth import failed; credentials suppressed');
        existing=(await db.query('select id,encrypted_password,raw_user_meta_data from auth.users where id=$1',[data.user.id])).rows[0];
      }
      if(existing.encrypted_password!==a.passwordHash || existing.raw_user_meta_data?.branchConvexImport!==source.fingerprint || existing.raw_user_meta_data?.convexUserId!==a.userId)throw Error('Existing Auth identity mismatch; no password reset performed');
      manifest.accounts[a.userId]=existing.id;save();
    }
    for(const file of source.files) {
      const object=(await db.query("select id from storage.objects where bucket_id='branch-files' and name=$1",[file.objectPath])).rows[0];
      if (!object) {
        const {error}=await admin.storage.from('branch-files').upload(file.objectPath,fs.readFileSync(file.filename),{contentType:file.contentType||'application/octet-stream',upsert:false});
        if(error)throw Error('Storage import failed; no overwrite performed');
      }
      const {data,error}=await admin.storage.from('branch-files').download(file.objectPath);
      if(error||!data||hash(Buffer.from(await data.arrayBuffer()))!==file.sha256)throw Error('Uploaded file checksum mismatch');
      manifest.files[file.id]={path:file.objectPath,sha256:file.sha256};save();
    }
    await db.query('begin');
    try {
      await db.query("set local lock_timeout='15s'");
      await db.query('select id from branch_private.runtime_lock where id=1 for update');
      await checkDestination(db,source);
      const before=(await db.query('select * from branch_private.records')).rows;
      await insertRecords(db,source.records);
      for(const a of source.accounts) {
        await db.query('insert into branch_private.accounts(auth_id,user_id,username) values($1,$2,$3)',[manifest.accounts[a.userId],a.userId,a.username]);
        await db.query('insert into public.branch_revisions(user_id) values($1)',[manifest.accounts[a.userId]]);
      }
      await db.query('set constraints all immediate');
      await verifyRecords(db,source.records);
      await verifyRecords(db,before.map(r=>({...r,created_at:Number(r.created_at)})));
      await db.query('commit');
      manifest.complete=true;manifest.completedAt=new Date().toISOString();manifest.importedRecords=source.records.length;manifest.existingRecordsPreserved=before.length;save();
    } catch(e){await db.query('rollback');throw e;}
    console.log(JSON.stringify({complete:true,sourceRecords:source.records.length,accounts:source.accounts.length,verifiedFiles:source.files.length,existingRecordsPreserved:manifest.existingRecordsPreserved,counts:(await db.query('select collection,count(*)::int as count from branch_private.records group by collection order by collection')).rows}));
  } finally {await db.end();}
}
module.exports={snapshot,convert,insertRecords,checkDestination,verifyRecords};
if(require.main===module)main().catch(e=>{console.error(e.code ? 'Database operation failed ('+e.code+'); details suppressed.' : e.name==='AssertionError' ? 'Record equality verification failed; private values suppressed.' : e.message);process.exitCode=1;});
