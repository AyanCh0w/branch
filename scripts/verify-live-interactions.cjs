// Explicit production smoke test. Creates isolated QA identities/board, measures
// the actual WebSocket path, verifies revocation, then removes only those fixtures.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const WebSocket=require('ws'),{Client}=require('pg'),{createClient}=require('@supabase/supabase-js');
const cfg=require('../backend/config.cjs');
if(!process.argv.includes('--run'))throw Error('Pass --run to create and clean isolated QA fixtures.');
const base='https://joinbranch.dev',file='backups/live-interaction-qa.json';
const fixture={project:cfg.url,accounts:[],boardIds:[]},sockets=[];const report={checkedAt:new Date().toISOString()};
const save=()=>fs.writeFileSync(file,JSON.stringify(fixture,null,2),{mode:0o600});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function request(body,account){const r=await fetch(base+'/api/backend',{method:'POST',headers:{'Content-Type':'application/json',...(account?{Authorization:'Bearer '+account.session.access_token}:{})},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d;}
const call=async(a,name,args={},kind='mutation')=>(await request({kind,name,args},a)).value;
async function socket(account,board){
 const ws=new WebSocket(base.replace('https:','wss:')+'/api/live?board='+board,{headers:{Origin:base}});sockets.push(ws);ws.messages=[];ws.closed=false;
 ws.on('message',raw=>{const m=JSON.parse(raw.toString());ws.messages.push({...m,received:Date.now()});});ws.on('close',()=>ws.closed=true);ws.on('error',()=>{});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Live handshake timed out')),10000);ws.once('open',()=>ws.send(JSON.stringify({type:'auth',accessToken:account.session.access_token,token:'',tabId:crypto.randomUUID()})));ws.on('message',raw=>{if(JSON.parse(raw.toString()).type==='ready'){clearTimeout(timeout);resolve();}});ws.once('close',()=>{clearTimeout(timeout);reject(Error('Live access rejected'));});});return ws;
}
async function cleanup(){
 for(const s of sockets)s.close();
 if(fixture.boardIds.length&&fixture.accounts[0])await call(fixture.accounts[0],'library:archive',{boardId:fixture.boardIds[0]});
 const db=new Client({connectionString:cfg.database});await db.connect();
 try{
  const authIds=fixture.accounts.map(a=>a.session.user.id),userIds=fixture.accounts.map(a=>a.profile.id),boardIds=fixture.boardIds;
  assert(fixture.accounts.every(a=>/^qa_live_[a-f0-9]+_(owner|editor)$/.test(a.username)));
  const owned=await db.query('select id,data from branch_private.records where id=any($1::text[])',[boardIds]);assert(owned.rows.every(b=>userIds.includes(b.data.ownerId)&&b.data.title==='Live interaction QA'));
  await db.query('begin');await db.query('select id from branch_private.runtime_lock where id=1 for update');
  await db.query('delete from branch_private.accounts where auth_id=any($1::uuid[])',[authIds]);
  await db.query('delete from public.branch_revisions where user_id=any($1::uuid[])',[authIds]);
  await db.query("delete from branch_private.records where id=any($1::text[]) or data->>'boardId'=any($2::text[]) or data->>'userId'=any($3::text[])",[[...boardIds,...userIds],boardIds,userIds]);await db.query('commit');
  const admin=createClient(cfg.url,cfg.secret,{auth:{persistSession:false,autoRefreshToken:false}});
  for(const id of authIds){const {error}=await admin.auth.admin.deleteUser(id);if(error)throw error;}
  fixture.accounts=fixture.accounts.map(a=>({username:a.username,authId:a.session.user.id,userId:a.profile.id}));fixture.cleanedAt=new Date().toISOString();save();report.cleaned=true;
 }finally{await db.end();}
}
(async()=>{
 try{
  const prefix='qa_live_'+crypto.randomBytes(6).toString('hex');
  for(const role of ['owner','editor']){const username=prefix+'_'+role,result=await request({auth:'signup',args:{username,password:crypto.randomBytes(24).toString('hex')}});const a={username,session:result.session};a.profile=await call(a,'accounts:me',{},'query');fixture.accounts.push(a);save();}
  const [owner,editor]=fixture.accounts,board=await call(owner,'library:create',{title:'Live interaction QA'});fixture.boardIds.push(board);save();
  await call(owner,'sharing:addMember',{boardId:board,username:editor.username,role:'editor'});
  const a=await socket(owner,board),b=await socket(editor,board),times=new Map();
  for(let i=0;i<30;i++){times.set(i,Date.now());a.send(JSON.stringify({type:'cursor',position:{x:i,y:50}}));await wait(34);}
  await wait(250);const cursors=b.messages.filter(m=>m.type==='cursor');assert.equal(cursors.length,30);const latency=cursors.map(m=>m.received-times.get(m.position.x)).sort((x,y)=>x-y);report.cursors={count:30,medianMs:latency[15],p95Ms:latency[28],maxMs:latency[29]};
  for(const text of ['h','he','hel','hell','hello'])a.send(JSON.stringify({type:'text',nodeKey:'qa_note',field:'body',text,epoch:0}));await wait(300);assert.deepEqual(b.messages.filter(m=>m.type==='text').map(m=>m.text),['h','he','hel','hell','hello']);report.characters=true;
  const settings=await call(owner,'sharing:settings',{boardId:board},'query'),member=settings.members.find(m=>m.userId===editor.profile.id);assert(member);
  await call(owner,'sharing:changeMemberRole',{memberId:member.id,role:'viewer'});await wait(150);assert(a.closed&&b.closed,'Role change must disconnect old grants');
  const a2=await socket(owner,board),b2=await socket(editor,board);assert.equal(b2.messages[0].role,'viewer');b2.send(JSON.stringify({type:'text',nodeKey:'qa_note',field:'body',text:'denied',epoch:0}));await wait(200);assert(!a2.messages.some(m=>m.type==='text'));report.viewerBlocked=true;
  await call(owner,'sharing:removeMember',{memberId:member.id});await wait(100);assert(a2.closed&&b2.closed);await assert.rejects(socket(editor,board));report.revocation=true;
  const a3=await socket(owner,board);assert.equal(a3.messages[0].type,'ready');report.ownerReconnect=true;
 }finally{await cleanup();}
 fs.writeFileSync('backups/live-interaction-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error('Live interaction check failed:',e.message);process.exitCode=1;});
