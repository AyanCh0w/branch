const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const {createServer}=require('../../mcp/server.cjs');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const http=require('node:http');
const path=require('node:path');
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

test('actual MCP launcher signs in through Supabase HTTP and refreshes its session',async()=>{
 const requests=[];
 const token=exp=>'header.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.test';
 const expired=token(1),fresh=token(Math.floor(Date.now()/1000)+3600);
 const backend=http.createServer(async(req,res)=>{
  let text='';for await(const part of req)text+=part;
  const body=JSON.parse(text);requests.push({body,authorization:req.headers.authorization,path:req.url});
  let result;
  if(body.auth==='signin')result={status:'complete',tokens:{accessToken:expired,refreshToken:'refresh-test'}};
  else if(body.auth==='refresh')result={kind:'rotated',tokens:{accessToken:fresh,refreshToken:'new-refresh-test'}};
  else result={value:[]};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
 });
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));
 const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve(__dirname,'../../mcp/server.cjs')],env:{BRANCH_APP_URL:'http://127.0.0.1:'+backend.address().port,BRANCH_USERNAME:'test-user',BRANCH_PASSWORD:'test-password'},stderr:'pipe'});
 const client=new Client({name:'launcher-test',version:'1'});
 try{
  await client.connect(transport);
  const expectResult=await client.callTool({name:'list_boards',arguments:{}});
  assert(!expectResult.isError);assert.equal(expectResult.content[0].text,'[]');
  assert.deepEqual(requests.map(r=>r.body.auth||r.body.name),['signin','refresh','library:list']);
  assert.equal(requests[0].body.args.username,'test-user');
  assert.equal(requests[1].body.args.refreshToken,'refresh-test');
  assert.equal(requests[2].authorization,'Bearer '+fresh);
  assert(requests.every(r=>r.path==='/api/backend'));
 }finally{await client.close();await transport.close();await new Promise(r=>backend.close(r));}
});
