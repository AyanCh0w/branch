const {test}=require('node:test'),assert=require('node:assert/strict');
const {hasConvexRuntime}=require('../../scripts/audit-runtime.cjs');
test('deployment audit rejects Convex endpoints and bundled clients',()=>{
 for(const source of ['https://example.convex.cloud','wss://example.convex.cloud/api/sync','https://example.convex.site/path','// node_modules/convex/dist/browser.js','// node_modules/@convex-dev/auth/index.js','new ConvexClient(url)','new ConvexHttpClient(url)','import {x} from "convex/browser"','require("@convex-dev/auth")'])assert(hasConvexRuntime(source),source);
});
test('local startup audit rejects stale Convex bundles and missing builds',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'branch-runtime-'));
 const audit=()=>spawnSync(process.execPath,[path.resolve(__dirname,'../../scripts/audit-runtime.cjs'),'--local'],{cwd:root,encoding:'utf8'});
 try{
  assert.notEqual(audit().status,0);
  fs.mkdirSync(path.join(root,'app'));fs.mkdirSync(path.join(root,'backend'));
  for(const file of ['app/accounts.bundle.js','backend/server.bundle.cjs','backend/worker.bundle.cjs'])fs.writeFileSync(path.join(root,file),'fetch("https://example.supabase.co")');
  assert.equal(audit().status,0);
  fs.writeFileSync(path.join(root,'app/accounts.bundle.js'),'new ConvexReactClient(url)');
  const stale=audit();assert.notEqual(stale.status,0);assert.match(stale.stderr,/Convex runtime reference/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('deployment audit allows Supabase, same-origin APIs, and historical migration comments',()=>{
 for(const source of ['https://example.supabase.co','fetch("/api/backend")','// Existing Convex usernames include spaces'])assert(!hasConvexRuntime(source),source);
});
