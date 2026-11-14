const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {snapshot,checkDestination}=require('../append-convex-snapshot.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'branch-import-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const put=(table,rows)=>{fs.mkdirSync(path.join(root,table),{recursive:true});fs.writeFileSync(path.join(root,table,'documents.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n'));};return {root,put};}
const user={_id:'user1',_creationTime:1,name:'Test',kind:'guest'};
const board={_id:'board1',_creationTime:2,title:'Test',ownerId:'user1',development:false,initialized:true};
test('missing user requires explicit history preservation and gains no account',t=>{
 const {root,put}=fixture(t);put('boards',[board]);
 assert.throws(()=>snapshot(root),/Missing or inconsistent/);
 const s=snapshot(root,{preserveMissingUsers:true});assert.equal(s.accounts.length,0);
 assert.deepEqual(s.records.find(r=>r.id==='user1').data,{name:'Unavailable user (migrated history)',kind:'guest'});
 assert.deepEqual(s.missingUsers,['user1']);
});
test('missing board is never synthesized',t=>{
 const {root,put}=fixture(t);put('users',[user]);put('boardMembers',[{_id:'member1',_creationTime:2,boardId:'missing',userId:'user1',role:'owner'}]);
 assert.throws(()=>snapshot(root,{preserveMissingUsers:true}),/boards/);
});
test('expired-session-only missing users do not create history identities',t=>{
 const {root,put}=fixture(t);put('sessions',[{_id:'s1',_creationTime:1,userId:'missing',tokenHash:'test',expiresAt:2}]);
 const s=snapshot(root);assert.equal(s.records.length,0);assert.equal(s.skipped.sessions,1);
});
test('source file extensions are supported and corruption is rejected',t=>{
 const {root,put}=fixture(t);put('users',[user]);put('boards',[board]);
 const bytes=Buffer.from('sample file');put('_storage',[{_id:'f1',_creationTime:3,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('base64'),contentType:'application/pdf'}]);
 fs.writeFileSync(path.join(root,'_storage/f1.pdf'),bytes);
 put('fileUploads',[{_id:'upload1',_creationTime:2,boardId:'board1',userId:'user1',storageId:'f1'}]);
 const s=snapshot(root);assert.equal(s.files[0].objectPath,'board1/f1');
 fs.writeFileSync(path.join(root,'_storage/f1.pdf'),'corrupt');assert.throws(()=>snapshot(root),/checksum mismatch/);
});
test('duplicate identities are rejected',t=>{
 const {root,put}=fixture(t);put('users',[user,user]);assert.throws(()=>snapshot(root),/Duplicate source identity/);
});
test('destination identity and username collisions never overwrite',async()=>{
 const source={records:[{id:'r1'}],accounts:[{username:'same'}]};
 await assert.rejects(checkDestination({query:async()=>({rowCount:1})},source),/refuse overwrite/);
 let calls=0;await assert.rejects(checkDestination({query:async()=>({rowCount:++calls===2?1:0})},source),/identity reconciliation/);
});
