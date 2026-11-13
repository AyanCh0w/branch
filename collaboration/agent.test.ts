import {convexTest} from 'convex-test';
import {it,expect,vi,afterEach} from 'vitest';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.ts');
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});
async function setup(agent=true){
 vi.useFakeTimers();vi.stubEnv('DEV_BRIDGE_SECRET','agent-test');vi.stubEnv('ENABLE_DEVELOPMENT_BRIDGE','true');
 const t=convexTest(schema,modules);
 const user=await t.mutation(api.boards.developmentSession,{secret:'agent-test',identityKey:'agent-owner',token:'agent-token'});
 const auth={boardId:user.boardId,token:'agent-token'};
 await t.mutation(api.boards.initialize,{...auth,title:'Research',nodes:[{id:'agent',type:'thread',agent,agentName:'Atlas',title:'Find the people',x:600,y:100,draft:'Find all hackathon organizers and judges at https://example.com',messages:[],contexts:[]},{id:'obstacle',type:'plan',title:'Existing work',x:80,y:100,width:440,layoutHeight:1200,body:'Do not overwrite'}]});
 const runId=await t.mutation(api.chat.send,{...auth,nodeKey:'agent',requestId:'research',expectedVersion:0});
 return{t,auth,user,runId};
}
it('canvas tools are idempotent, grouped, avoid existing cards and inherit only their parent context',async()=>{
 const {t,auth,runId}=await setup();await t.mutation(internal.chat.claim,{runId});
 await t.mutation(internal.chat.append,{runId,text:'Verified organizers. [Source](https://example.com/team)'});
 const node={kind:'chat',title:'Explore organizers',content:'Compare their backgrounds',url:''};
 const first=await t.mutation(internal.chat.createNode,{runId,callId:'branch',node});
 expect(await t.mutation(internal.chat.createNode,{runId,callId:'branch',node})).toEqual(first);
 await t.mutation(internal.chat.createNode,{runId,callId:'source',research:true,node:{kind:'website',title:'Team',content:'',url:'https://example.com/team'}});
 const board=await t.query(api.boards.read,auth),branch=board.nodes.find(n=>n.id===first.id)!;
 expect(branch.draft).toBe('Compare their backgrounds');expect(branch.activeRun).toBeUndefined();expect(branch.autoGroup).toBe('agent');
 expect(branch.contexts[0].body).toContain('Verified organizers');expect(branch.contexts[0].cutoff).toBe('research-assistant');
 const source=board.nodes.find(n=>n.researchSource)!;expect(source.y).toBeGreaterThanOrEqual(1364);expect(source.url).toBe('https://example.com/team');
 expect(board.nodes.find(n=>n.id==='agent')!.researchSources).toHaveLength(1);
 expect(board.nodes.find(n=>n.id==='obstacle')!.body).toBe('Do not overwrite');
 await expect(t.mutation(internal.chat.createNode,{runId,callId:'bad',node:{...node,kind:'website',url:'javascript:alert(1)'}})).rejects.toThrow();
});
it('stop rejects queued claims, late text, scheduled continuation and canvas writes',async()=>{
 const {t,auth,runId}=await setup();await t.mutation(internal.chat.claim,{runId});
 await t.mutation(api.chat.stop,{...auth,nodeKey:'agent'});
 await t.mutation(internal.chat.append,{runId,text:'Late reply',done:true});
 await t.mutation(internal.chat.checkpoint,{runId,checkpoint:{phase:1},usage:{}});
 await expect(t.mutation(internal.chat.createNode,{runId,callId:'late',node:{kind:'note',title:'Late',content:'Late',url:''}})).rejects.toThrow('no longer active');
 expect(await t.mutation(internal.chat.claim,{runId})).toBeNull();
 const board=await t.query(api.boards.read,auth),agent=board.nodes.find(n=>n.id==='agent')!;
 expect(agent.activeRun).toBeUndefined();expect(agent.agentStage).toBe('Stopped');expect(agent.messages.at(-1).text).toBe('');
 expect((await t.run(ctx=>ctx.db.get(runId)))!.status).toBe('cancelled');
});
it('research schedules three passes, preserves reasoning/tool results and accounts for every response',async()=>{
 const {t,auth,runId,user}=await setup();vi.stubEnv('OPENAI_API_KEY','test-key');
 const requests:any[]=[];
 const outputs:any[][]=[
  [{type:'reasoning',id:'r1',encrypted_content:'encrypted'},{type:'message',role:'assistant',content:[{type:'output_text',text:'Discovery notes'}]}],
  [{type:'message',role:'assistant',content:[{type:'output_text',text:'Verified findings'}]}],
  [{type:'function_call',name:'create_node',call_id:'save',arguments:JSON.stringify({kind:'note',title:'People',content:'Ada — judge. [Team](https://example.com/team)',url:''})}],
  [{type:'message',role:'assistant',content:[{type:'output_text',text:'Ada is a judge.'}]}]
 ];
 vi.stubGlobal('fetch',vi.fn(async(_url:any,opts:any)=>{
  const body=JSON.parse(opts.body);requests.push(body);
  if(!body.stream)return new Response(JSON.stringify({output:[]}));
  const response={output:outputs.shift(),usage:{input_tokens:10,output_tokens:5,total_tokens:15}};
  return new Response('data: '+JSON.stringify({type:'response.completed',response})+'\n\n');
 }));
 await t.finishAllScheduledFunctions(vi.runAllTimers);
 const run=(await t.run(ctx=>ctx.db.get(runId)))!;
 expect(run.status).toBe('complete');expect(run.usage.total_tokens).toBe(60);expect(run.billedUserId).toBe(user.userId);
 const streamed=requests.filter(r=>r.stream);expect(streamed).toHaveLength(4);
 expect(streamed.every(r=>r.model==='gpt-5.4-mini'&&r.store===false)).toBe(true);
 expect(streamed[1].input.some((i:any)=>i.encrypted_content==='encrypted')).toBe(true);
 expect(streamed[3].input.some((i:any)=>i.type==='function_call_output'&&i.call_id==='save'&&i.output.includes('People'))).toBe(true);
 const board=await t.query(api.boards.read,auth);expect(board.nodes.find(n=>n.id==='agent')!.messages.at(-1).text).toBe('Ada is a judge.');expect(board.nodes.find(n=>n.title==='People')).toBeDefined();
});
