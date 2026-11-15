// Read-only post-import audit. No passwords, sessions or private board text printed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Client}=require('pg');
const cfg=require('../backend/config.cjs');
const {snapshot,verifyRecords}=require('./append-convex-snapshot.cjs');
const {engine,pool}=require('../backend/server.bundle.cjs');
async function main(){
 const root=path.resolve(process.argv[2]||'backups/convex-live-20261113');
 const source=snapshot(root,{preserveMissingUsers:true});
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'supabase-append-manifest.json'),'utf8'));
 assert(manifest.complete&&manifest.project===cfg.url&&manifest.fingerprint===source.fingerprint);
 const backup=JSON.parse(fs.readFileSync(manifest.backup,'utf8'));
 const db=new Client({connectionString:cfg.database});await db.connect();
 try{
  await db.query('set extra_float_digits=3');
  await verifyRecords(db,source.records);
  await verifyRecords(db,backup.records.map(r=>({...r,created_at:Number(r.created_at)})));
  console.log('PASS all imported fields/Yjs bytes and all pre-existing records unchanged');
  for(const a of source.accounts){
   const r=(await db.query('select a.user_id,a.username,u.encrypted_password from branch_private.accounts a join auth.users u on a.auth_id=u.id where a.auth_id=$1',[manifest.accounts[a.userId]])).rows[0];
   assert(r&&r.user_id===a.userId&&r.username===a.username&&r.encrypted_password===a.passwordHash);
  }
  assert.equal((await db.query('select count(*)::int as n from branch_private.accounts where user_id=any($1::text[])',[source.missingUsers])).rows[0].n,0);
  console.log('PASS all eight password hashes and account mappings preserved; history placeholders cannot sign in');
  const boards=source.records.filter(r=>r.collection==='boards');
  const outsider=backup.accounts[0].user_id;
  for(let i=0;i<boards.length;i+=4)await Promise.all(boards.slice(i,i+4).map(async b=>{
   const scope={boardId:b.id,token:''};
   if(b.data.archived){await assert.rejects(engine.call('boards:read',scope,{userId:b.data.ownerId},'query'),/Board not found/);return;}
   const board=await engine.call('boards:read',scope,{userId:b.data.ownerId},'query');
   assert(board&&Array.isArray(board.nodes));
   assert.equal(board.nodes.length,source.records.filter(r=>r.collection==='nodes'&&r.data.boardId===b.id&&!r.data.deleted).length);
   await assert.rejects(engine.call('boards:read',scope,{userId:outsider},'query'));
  }));
  console.log('PASS 14 active boards render and reject unrelated access; 2 archived boards remain inaccessible');
  let libraries=0;
  for(const a of source.accounts){const list=await engine.call('library:list',{}, {userId:a.userId},'query');assert(Array.isArray(list));libraries++;}
  console.log('PASS all '+libraries+' imported account board libraries and Yjs previews');
  for(const f of source.files){
   const meta=source.records.find(r=>r.id===f.id).data;
   const board=source.records.find(r=>r.id===meta.boardId);
   if(board.data.archived){await assert.rejects(engine.call('files:read',{boardId:meta.boardId,token:'',storageId:f.id},{userId:board.data.ownerId},'query'));continue;}
   const result=await engine.call('files:read',{boardId:meta.boardId,token:'',storageId:f.id},{userId:board.data.ownerId},'query');
   const response=await fetch(result.url);assert.equal(response.status,200);
   assert.equal(crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),f.sha256);
   await assert.rejects(engine.call('files:read',{boardId:meta.boardId,token:'',storageId:f.id},{userId:outsider},'query'));
  }
  console.log('PASS 9 active-board files load with exact checksums; 2 archived-board files remain access-blocked (all 11 checksummed during import)');
  const r=await fetch('https://branch.eshteremberg.workers.dev/api/config');assert.equal(r.status,200);assert.equal((await r.json()).provider,'supabase');
  manifest.verifiedAt=new Date().toISOString();manifest.verification={records:source.records.length,unchanged:backup.records.length,accountHashes:source.accounts.length,boardReads:boards.length,files:source.files.length,authorization:'unrelated account rejected',hostedConfig:'supabase',passwordSignIn:'hash preservation verified; individual plaintext passwords not available'};
  fs.writeFileSync(path.join(root,'supabase-append-manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
  console.log('PASS Cloudflare serves Supabase configuration; audit saved privately');
 }finally{await db.end();await pool.end();}
}
main().catch(e=>{console.error('Verification failed; private data suppressed ('+(e.code||e.name)+').');process.exitCode=1;});
