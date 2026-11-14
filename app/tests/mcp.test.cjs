const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const {createServer}=require('../../mcp/server.cjs');
test('MCP handshake, tool discovery, plan writes, validation and redacted failures',async()=>{
 const calls=[];
 const backend={query:async()=>[],mutation:async(name,args)=>{calls.push({name,args});if(args.title==='fail')throw Error('secret-credential');return name==='library:create'?'board-1':{id:'plan-task',version:0};}};
 const server=createServer(backend),client=new Client({name:'test',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{
  const {tools}=await client.listTools();assert.equal(tools.length,5);
  const board=await client.callTool({name:'create_board',arguments:{title:'Research'}});assert.match(board.content[0].text,/board-1/);
  const plan=await client.callTool({name:'update_plan',arguments:{boardId:'board-1',planId:'task',goal:'Compare',expectedVersion:-1,steps:[{title:'Verify',status:'working',detail:'Check evidence'}]}});assert.ok(!plan.isError);assert.equal(calls.at(-1).name,'boards:updatePlan');
  const bad=await client.callTool({name:'update_plan',arguments:{boardId:'board-1',planId:'task',goal:'Compare',expectedVersion:-1,steps:[]}});assert.ok(bad.isError);
  const fail=await client.callTool({name:'create_board',arguments:{title:'fail'}});assert.ok(fail.isError);assert.doesNotMatch(JSON.stringify(fail),/secret-credential/);
 }finally{await client.close();await server.close();}
});
