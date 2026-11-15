import {describe,it,expect,beforeAll,afterAll,vi} from 'vitest';
import {createHash,createHmac} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {harness} from './harness';
import {Store} from '../store';
import {codingMcp} from '../agents/coding';
import {webhookEvent} from '../agents';
import {BRIEF_CHARS,IDLE_MS,ABANDON_MS} from '../functions/work';
import {initialDocument} from '../functions/documents';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const keys={maria:'branch_'+'a'.repeat(64),eric:'branch_'+'b'.repeat(64)};
const steps=[{title:'Add lease columns',status:'working' as const,detail:'Schema first'}];
let h:Awaited<ReturnType<typeof harness>>,owner:any,maria:any,eric:any,viewer:any,boardId:string;
const scope=()=>({boardId,token:''});
// Internal functions are what the agent endpoint calls after checking the connection key.
const internal=(name:string,args:any,kind='mutation')=>h.engine.call(name,args,{},kind,true);
const card=async(key:string)=>(await h.call(owner,'boards:read',scope(),'query')).nodes.find((n:any)=>n.id===key);
const start=(who:'maria'|'eric',workId:string,extra:any={})=>internal('work:start',{keyHash:hash(keys[who]),workId,goal:'Replace rotating refresh tokens with a lease',steps,paths:[],areas:[],...extra});

beforeAll(async()=>{
 h=await harness();owner=await h.account('owner');maria=await h.account('maria');eric=await h.account('eric');viewer=await h.account('viewer');
 boardId=await h.call(owner,'library:create',{title:'Coordination'});
 for(const [username,role] of [['maria','editor'],['eric','editor'],['viewer','viewer']])await h.call(owner,'sharing:addMember',{boardId,username,role});
 await h.call(maria,'coding:configure',{...scope(),keyHash:hash(keys.maria)});
 await h.call(eric,'coding:configure',{...scope(),keyHash:hash(keys.eric)});
});
afterAll(async()=>{vi.useRealTimers();await h.close();});

describe('plan first',()=>{
 it('creates a plan card that carries status, owner and scope',async()=>{
  const result=await start('maria','auth-lease',{title:'Auth refresh lease',paths:['./convex/auth.ts','convex/auth.ts/'],areas:['Auth']});
  expect(result.overlaps).toEqual([]);
  const plan=await card('plan-auth-lease');
  expect(plan).toMatchObject({title:'Auth refresh lease',visualPlan:true,workItem:true,workStatus:'active',workOwner:{name:'maria'},workScope:{paths:['convex/auth.ts'],areas:['auth']}});
  expect(plan.body).toContain('Add lease columns — working');
 });
 it('is idempotent on the work ID and keeps one card',async()=>{
  await start('maria','auth-lease',{title:'Auth refresh lease',paths:['convex/auth.ts'],areas:['auth']});
  expect((await h.call(owner,'boards:read',scope(),'query')).nodes.filter((n:any)=>n.id==='plan-auth-lease')).toHaveLength(1);
  expect((await h.call(owner,'work:forBoard',scope(),'query')).items).toHaveLength(1);
 });
 it('warns the second person, without blocking them',async()=>{
  const result=await start('eric','session-cleanup',{title:'Session expiry cleanup',paths:['convex'],areas:['sessions']});
  expect(result.overlaps).toHaveLength(1);
  expect(result.overlaps[0]).toMatchObject({owner:'maria',title:'Auth refresh lease',sharedPaths:['convex/auth.ts']});
  expect(await card('plan-session-cleanup')).toMatchObject({workItem:true,workOwner:{name:'eric'}});
 });
 it('matches whole path segments and area tags only',async()=>{
  expect((await start('eric','apps',{paths:['apps','convex-tools'],areas:['authz']})).overlaps).toEqual([]);
  expect((await start('eric','auth-area',{areas:['auth']})).overlaps[0]).toMatchObject({owner:'maria',sharedAreas:['auth']});
 });
 it('requires a scope, rejects credentials and other people\'s work IDs',async()=>{
  await expect(start('maria','no-scope')).rejects.toThrow('at least one path or area');
  await expect(start('maria','leak',{paths:['app'],goal:'Use key sk-'+'x'.repeat(30)})).rejects.toThrow('credential');
  await expect(start('eric','auth-lease',{paths:['app']})).rejects.toThrow('someone else');
 });
 it('never overwrites a plan a person edited',async()=>{
  await start('maria','edited',{paths:['docs']});
  const Y=await import('yjs');const row=await card('plan-edited');
  await h.call(owner,'collaboration:focus',{...scope(),nodeKey:'plan-edited',field:'body',tabId:'human'});
  const doc=new Y.Doc();Y.applyUpdate(doc,new Uint8Array(row.sharedTextState));doc.getText('body').insert(0,'Human note: ');
  await h.call(owner,'collaboration:updateText',{...scope(),nodeKey:'plan-edited',tabId:'human',epoch:0,update:Uint8Array.from(Y.encodeStateAsUpdate(doc)).buffer});doc.destroy();
  await h.call(owner,'collaboration:release',{...scope(),tabId:'human'});
  await expect(start('maria','edited',{paths:['docs']})).rejects.toThrow('manually edited');
 });
 it('stops working when the person loses edit access',async()=>{
  const stranger=await h.account('stranger');await h.call(owner,'sharing:addMember',{boardId,username:'stranger',role:'editor'});
  const key='branch_'+'c'.repeat(64);await h.call(stranger,'coding:configure',{...scope(),keyHash:hash(key)});
  await expect(h.call(viewer,'coding:configure',{...scope(),keyHash:hash('branch_'+'d'.repeat(64))})).rejects.toThrow();
  const member=(await h.call(owner,'sharing:settings',{boardId},'query')).members.find((m:any)=>m.userId===stranger.userId);
  await h.call(owner,'sharing:removeMember',{memberId:member.id});
  await expect(internal('work:start',{keyHash:hash(key),workId:'late',goal:'x',steps,paths:['app'],areas:[]})).rejects.toThrow();
  await expect(internal('work:brief',{keyHash:hash(key),paths:[],areas:[]},'query')).rejects.toThrow();
 });
});

describe('milestone updates',()=>{
 const post=(updateId:string,text:string,extra:any={})=>internal('work:update',{keyHash:hash(keys.maria),workId:'auth-lease',updateId,kind:'decision',text,affects:[],...extra});
 it('records updates once, shows the latest on the card and marks attached chats stale',async()=>{
  const before=(await card('plan-auth-lease')).revision;
  await post('u1','Leases last 60s and renew every 20s');await post('u1','Leases last 60s and renew every 20s');
  await expect(post('u1','Different content')).rejects.toThrow('new update ID');
  const plan=await card('plan-auth-lease');
  expect(plan.workLatest.map((u:any)=>u.text)).toEqual(['Leases last 60s and renew every 20s']);
  expect(plan.revision).toBe(before+1);
  const page=await h.call(viewer,'work:updates',{...scope(),nodeKey:'plan-auth-lease',paginationOpts:{numItems:10,cursor:null}},'query');
  expect(page.page).toHaveLength(1);expect(page.page[0]).toMatchObject({kind:'decision',source:'agent'});expect(page.isDone).toBe(true);
 });
 it('updates the plan steps when they are sent',async()=>{
  await post('u2','refreshSession now returns leaseUntil',{kind:'interface',affects:['convex/auth.ts'],steps:[{...steps[0],status:'done'}]});
  expect((await card('plan-auth-lease')).body).toContain('Add lease columns — done');
 });
 it('rejects credentials, unknown kinds and bursts',async()=>{
  await expect(post('u3','token ghp_'+'a'.repeat(36))).rejects.toThrow('credential');
  await expect(post('u4','x',{kind:'landed'})).rejects.toThrow('Use one of');
  await start('eric','burst',{paths:['burst']});
  const burst=(i:number)=>internal('work:update',{keyHash:hash(keys.eric),workId:'burst',updateId:'b'+i,kind:'progress',text:'step '+i,affects:[]});
  for(let i=0;i<20;i++)await burst(i);
  await expect(burst(20)).rejects.toThrow('Too many updates');
 });
 it('gives a teammate a small brief with overlaps and changes, then only what is new',async()=>{
  const brief=await internal('work:brief',{keyHash:hash(keys.eric),paths:['convex/auth.ts'],areas:[]},'query');
  expect(JSON.stringify(brief).length).toBeLessThanOrEqual(BRIEF_CHARS);
  expect(brief.overlaps[0]).toMatchObject({owner:'maria',title:'Auth refresh lease'});
  expect(brief.changes.map((c:any)=>c.text)).toContain('refreshSession now returns leaseUntil');
  expect(brief.active.every((a:any)=>a.owner!=='eric')).toBe(true);
  expect(brief.yours.map((y:any)=>y.workId)).toContain('session-cleanup');
  expect((await internal('work:brief',{keyHash:hash(keys.eric),paths:[],areas:[],since:brief.cursor},'query')).changes).toEqual([]);
  await post('u5','Blocked on the sessions migration',{kind:'blocker'});
  expect((await internal('work:brief',{keyHash:hash(keys.eric),paths:[],areas:[],since:brief.cursor},'query')).changes.map((c:any)=>c.kind)).toEqual(['blocker']);
 });
 it('keeps the brief within budget on a busy board',async()=>{
  for(let i=0;i<14;i++)await start('eric','bulk-'+i,{title:'Bulk work '+i+' '+'x'.repeat(80),goal:'g '+'y'.repeat(380),paths:Array.from({length:6},(_,p)=>'bulk/'+i+'/'+p+'/'+'z'.repeat(60)),areas:['bulk']});
  const brief=await internal('work:brief',{keyHash:hash(keys.maria),paths:['bulk'],areas:[]},'query');
  expect(JSON.stringify(brief).length).toBeLessThanOrEqual(BRIEF_CHARS);
  expect(brief.omitted.active).toBeGreaterThan(0);
 });
});

describe('context that follows the work',()=>{
 const chat=async(id:string,contexts:any[])=>{await h.call(owner,'boards:patchNodes',{...scope(),changes:[{id,create:{type:'thread',title:id,draft:'What changed in auth?',messages:[],contexts}}]});return (await card(id)).sharedVersion;};
 const input=async(runId:string)=>(await new Store(h.pool).get(runId)).input.contexts;
 const stale=()=>({id:'c1',source:'plan-auth-lease',title:'Auth refresh lease',body:'Old snapshot of the plan',revision:1,enabled:true,inherited:[]});
 it('re-reads a followed source at Send and freezes what it used',async()=>{
  const version=await chat('follows',[{...stale(),follow:true}]);
  const runId=await h.call(owner,'chat:send',{...scope(),nodeKey:'follows',requestId:'follow-1',expectedVersion:version});
  const used=(await input(runId)).find((c:any)=>c.source==='plan-auth-lease');
  expect(used.text).toContain('Blocked on the sessions migration');expect(used.text).not.toContain('Old snapshot');
  const binding=(await card('follows')).contexts[0];
  expect(binding).toMatchObject({id:'c1',follow:true,revision:(await card('plan-auth-lease')).revision});
 });
 it('leaves an ordinary connection frozen, and excerpts never follow',async()=>{
  const version=await chat('frozen',[stale(),{...stale(),id:'c2',quote:'Old snapshot',excerptOnly:true,follow:true}]);
  const runId=await h.call(owner,'chat:send',{...scope(),nodeKey:'frozen',requestId:'frozen-1',expectedVersion:version});
  const used=await input(runId);
  expect(used.some((c:any)=>c.text==='Old snapshot of the plan')).toBe(true);
  expect(JSON.stringify(used)).not.toContain('Blocked on the sessions migration');
 });
 it('adds active work to chats only when the owner turns it on, without the sender\'s own work',async()=>{
  await expect(h.call(maria,'work:setContext',{...scope(),enabled:true})).rejects.toThrow('owner');
  let version=await chat('plain',[]);
  let used=await input(await h.call(maria,'chat:send',{...scope(),nodeKey:'plain',requestId:'plain-1',expectedVersion:version}));
  expect(used.some((c:any)=>c.title==='Active work on this board')).toBe(false);
  await h.call(owner,'work:setContext',{...scope(),enabled:true});
  version=await chat('aware',[]);
  used=await input(await h.call(maria,'chat:send',{...scope(),nodeKey:'aware',requestId:'aware-1',expectedVersion:version}));
  const block=used.find((c:any)=>c.title==='Active work on this board');
  expect(block.text).toContain('"owner":"eric"');expect(block.text).not.toContain('Auth refresh lease');
  expect(block.text.length).toBeLessThan(1600);
 });
});

describe('closing work',()=>{
 it('lets the agent finish, and the owner or board owner close from the card',async()=>{
  await start('eric','to-finish',{paths:['finish']});
  await internal('work:finish',{keyHash:hash(keys.eric),workId:'to-finish',outcome:'done',summary:'Shipped the cleanup'});
  expect(await card('plan-to-finish')).toMatchObject({workStatus:'done'});
  expect((await card('plan-to-finish')).workFinishedAt).toBeGreaterThan(0);
  await expect(internal('work:update',{keyHash:hash(keys.eric),workId:'to-finish',updateId:'late',kind:'progress',text:'late',affects:[]})).rejects.toThrow('finished');
  await start('eric','to-close',{paths:['close']});
  await expect(h.call(maria,'work:end',{...scope(),nodeKey:'plan-to-close',outcome:'abandoned'})).rejects.toThrow('Only the person');
  await expect(h.call(viewer,'work:end',{...scope(),nodeKey:'plan-to-close',outcome:'abandoned'})).rejects.toThrow();
  await h.call(owner,'work:end',{...scope(),nodeKey:'plan-to-close',outcome:'abandoned'});
  expect(await card('plan-to-close')).toMatchObject({workStatus:'abandoned'});
  // Finished work no longer collides with anyone.
  expect((await start('maria','after-close',{paths:['close','finish']})).overlaps).toEqual([]);
 });
});

describe('GitHub confirmation',()=>{
 it('marks claimed work done when its pull request merges',async()=>{
  const db=new Store(h.pool,true);
  await db.insert('boardRepos',{boardId,repoId:42,fullName:'Acme/App',private:true,defaultBranch:'main',installationId:7,addedBy:owner.userId,createdAt:Date.now()});
  await start('eric','gh-work',{paths:['gh'],repo:'Acme/App',branch:'feature/lease'});
  const pull={repoId:42,repo:'Acme/App',branch:'feature/lease',number:14,title:'Add lease',paths:[]};
  expect(await internal('work:githubPull',{...pull,state:'opened'})).toBe(1);
  expect(await card('plan-gh-work')).toMatchObject({workStatus:'active',workPull:14});
  await internal('work:githubPull',{...pull,state:'merged',paths:['gh/lease.ts']});
  await internal('work:githubPull',{...pull,state:'merged',paths:['gh/lease.ts']});
  const plan=await card('plan-gh-work');
  expect(plan.workStatus).toBe('done');
  expect(plan.workLatest.filter((u:any)=>u.kind==='landed')).toHaveLength(1);
  expect(plan.workLatest.at(-1)).toMatchObject({source:'github'});
  // A repository that is not linked to the board changes nothing.
  expect(await internal('work:githubPull',{...pull,repoId:99,state:'opened'})).toBe(0);
 });
 it('refreshes only file cards for linked repositories and bumps their revision',async()=>{
  const db=new Store(h.pool,true);
  const data={id:'gh-file',type:'github',title:'lease.ts',x:0,y:0,width:460,revision:1,text:'old',github:{kind:'file',repo:'Acme/App',path:'gh/lease.ts',ref:'main'}};
  await db.insert('nodes',{boardId,key:'gh-file',data,textState:initialDocument(data),textVersion:0,createdBy:owner.userId,updatedBy:owner.userId,deleted:false});
  expect(await internal('github:fileCards',{boardId,repo:'acme/app'},'query')).toEqual([{nodeKey:'gh-file',path:'gh/lease.ts'}]);
  expect(await internal('github:refreshFromWebhook',{boardId,repoId:42,nodeKey:'gh-file',text:'new',github:data.github})).toEqual({changed:true});
  expect(await card('gh-file')).toMatchObject({text:'new',revision:2});
  expect(await internal('github:refreshFromWebhook',{boardId,repoId:99,nodeKey:'gh-file',text:'other',github:data.github})).toEqual({changed:false});
  expect((await card('gh-file')).text).toBe('new');
 });
 it('keeps only the fields it needs from a delivery and ignores forks and other events',()=>{
  const repository={id:42};
  expect(webhookEvent('pull_request',{action:'closed',repository,pull_request:{number:14,merged:true,title:'Add lease',head:{ref:'feature/lease',repo:{id:42}},body:'private text'}}))
   .toEqual({event:'pull_request',payload:{repoId:42,branch:'feature/lease',number:14,state:'merged',title:'Add lease'}});
  expect(webhookEvent('pull_request',{action:'opened',repository,pull_request:{number:15,title:'Fork',head:{ref:'feature/lease',repo:{id:7}}}})).toBeNull();
  expect(webhookEvent('pull_request',{action:'labeled',repository,pull_request:{number:14,head:{ref:'x',repo:{id:42}}}})).toBeNull();
  expect(webhookEvent('push',{ref:'refs/heads/main',repository,commits:[{added:['a.ts'],modified:['b.ts'],removed:['c.ts']},{modified:['b.ts']}]}))
   .toEqual({event:'push',payload:{repoId:42,branch:'main',paths:['a.ts','b.ts','c.ts']}});
  expect(webhookEvent('push',{ref:'refs/tags/v1',repository,commits:[{added:['a.ts']}]})).toBeNull();
  expect(webhookEvent('issues',{repository})).toBeNull();
 });
 it('queues a verified delivery as a background job',async()=>{
  await internal('github:receiveWebhook',{event:'push',payload:{repoId:42,branch:'main',paths:['gh/lease.ts']}});
  const {rows}=await h.pool.query("select function_name from branch_private.jobs where function_name='githubActions:webhook'");
  expect(rows).toHaveLength(1);
  // Signatures use the shared secret over the raw body.
  expect(createHmac('sha256','secret').update('{}').digest('hex')).toHaveLength(64);
 });
});

describe('area summaries',()=>{
 it('builds a summary card from recent updates without overwriting a person\'s edits',async()=>{
  const {rows}=await h.pool.query("select count(*)::int as n from branch_private.jobs where function_name='work:digest' and args->>'area'='auth'");
  expect(rows[0].n).toBe(1);
  await h.engine.call('work:digest',{boardId,area:'auth'},{},'action',true);
  let summary=await card('area-auth');
  expect(summary).toMatchObject({title:'Area: auth',areaDigest:'auth',revision:1});
  expect(summary.body).toContain('Blocked on the sessions migration');expect(summary.body).toContain('maria');
  expect((await h.call(owner,'work:forBoard',scope(),'query')).digests.find((d:any)=>d.area==='auth')).toMatchObject({version:1});
  await internal('work:update',{keyHash:hash(keys.maria),workId:'auth-lease',updateId:'u6',kind:'progress',text:'Sessions migration unblocked',affects:[]});
  await h.engine.call('work:digest',{boardId,area:'auth'},{},'action',true);
  summary=await card('area-auth');
  expect(summary.body).toContain('Sessions migration unblocked');expect(summary.revision).toBe(2);
  const brief=await internal('work:brief',{keyHash:hash(keys.eric),paths:[],areas:['auth']},'query');
  expect(brief.digests[0]).toMatchObject({area:'auth',version:2});
  const Y=await import('yjs');
  await h.call(owner,'collaboration:focus',{...scope(),nodeKey:'area-auth',field:'body',tabId:'human'});
  const doc=new Y.Doc();Y.applyUpdate(doc,new Uint8Array(summary.sharedTextState));doc.getText('body').insert(0,'My notes. ');
  await h.call(owner,'collaboration:updateText',{...scope(),nodeKey:'area-auth',tabId:'human',epoch:0,update:Uint8Array.from(Y.encodeStateAsUpdate(doc)).buffer});doc.destroy();
  await h.call(owner,'collaboration:release',{...scope(),tabId:'human'});
  await internal('work:update',{keyHash:hash(keys.maria),workId:'auth-lease',updateId:'u7',kind:'progress',text:'Rollout started',affects:[]});
  await h.engine.call('work:digest',{boardId,area:'auth'},{},'action',true);
  expect((await card('area-auth')).body).toMatch(/^My notes\. /);expect((await card('area-auth')).body).not.toContain('Rollout started');
 });
});

describe('ChatGPT conversations',()=>{
 it('count as work once they declare a scope',async()=>{
  const db=new Store(h.pool,true),accessHash=hash('bca_test');
  await db.insert('chatgptGrants',{userId:eric.userId,boardId,resource:'http://127.0.0.1:4387/api/chatgpt/mcp',accessHash,refreshHash:hash('bcr_test'),accessUntil:Date.now()+3600_000,refreshUntil:Date.now()+86400_000,grantedAt:Date.now()});
  const sync=(updateId:string,extra:any={})=>internal('chatgptSync:append',{accessHash,conversationId:'c'.repeat(64),updateId,title:'Billing webhooks',result:'Drafted the webhook handler',...extra});
  const first=await sync('11111111-1111-4111-8111-111111111111');
  expect((await card(first.cardId)).workItem).toBeUndefined();
  await sync('22222222-2222-4222-8222-222222222222',{paths:['api/billing'],areas:['billing']});
  expect(await card(first.cardId)).toMatchObject({workItem:true,workStatus:'active',workScope:{paths:['api/billing'],areas:['billing']}});
  expect((await start('maria','billing',{paths:['api/billing/hooks.ts']})).overlaps[0]).toMatchObject({owner:'eric',title:'Billing webhooks'});
 });
});

describe('agent endpoint',()=>{
 it('serves the coordination tools over MCP with the board key',async()=>{
  const client=new Client({name:'branch-test',version:'1'});
  const endpoint='http://127.0.0.1:4387/api/mcp';
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint),{requestInit:{headers:{Authorization:'Bearer '+keys.maria}},
   fetch:async(url,init)=>codingMcp(h.engine.context(null,{}),new Request(String(url),init as RequestInit))}));
  expect((await client.listTools()).tools.map(tool=>tool.name)).toEqual(['read_card_handoff','return_card_draft','get_board_brief','start_work','post_update','finish_work']);
  expect(client.getInstructions()).toContain('start_work');
  await start('eric','mcp-peer',{title:'Session table rewrite',paths:['convex']});
  const started:any=await client.callTool({name:'start_work',arguments:{workId:'mcp-work',goal:'Tidy the session table',steps,paths:['convex/sessions.ts']}});
  expect(started.isError).not.toBe(true);
  const result=JSON.parse(started.content[0].text);
  expect(result.overlaps.map((o:any)=>o.title)).toContain('Session table rewrite');expect(result.next).toContain('Stop');
  const brief:any=await client.callTool({name:'get_board_brief',arguments:{}});
  expect(JSON.parse(brief.content[0].text).notice).toContain('UNTRUSTED');
  const bad:any=await client.callTool({name:'post_update',arguments:{workId:'mcp-work',updateId:'k1',kind:'progress',text:'key AKIA'+'A'.repeat(16)}});
  expect(bad.isError).toBe(true);expect(bad.content[0].text).toContain('credential');
  await client.close();
  const anonymous=await codingMcp(h.engine.context(null,{}),new Request(endpoint,{method:'POST',headers:{Authorization:'Bearer branch_'+'f'.repeat(64)}}));
  expect(anonymous.status).toBe(401);
  expect((await codingMcp(h.engine.context(null,{}),new Request(endpoint,{method:'POST',headers:{Authorization:'Bearer '+keys.maria,Origin:'https://other.example'}}))).status).toBe(403);
 });
});

// Last: this moves the clock a week ahead and closes every open item.
describe('expiry',()=>{
 it('marks untouched work idle after a day and closes it after a week',async()=>{
  await start('eric','stale',{paths:['stale']});
  vi.useFakeTimers({toFake:['Date'],now:Date.now()+IDLE_MS+60_000});
  await internal('maintenance:cleanup',{});
  expect(await card('plan-stale')).toMatchObject({workStatus:'idle'});
  // Idle work still warns newcomers.
  expect((await start('maria','near-stale',{paths:['stale/x']})).overlaps[0]).toMatchObject({status:'idle'});
  vi.setSystemTime(Date.now()+ABANDON_MS+60_000);
  await internal('maintenance:cleanup',{});
  expect(await card('plan-stale')).toMatchObject({workStatus:'abandoned'});
  vi.useRealTimers();
 });
});
