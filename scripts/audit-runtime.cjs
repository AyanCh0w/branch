// Inspect the actual deployment artifacts, not the retained migration backups
// or Convex parity-test sources. Failure blocks the Cloudflare build/deploy.
const fs=require('node:fs'),path=require('node:path');
function hasConvexRuntime(text){
 return /(?:https?|wss?):\/\/[^\s/'"`]+\.convex\.(?:cloud|site)\b/i.test(text)
  || /node_modules\/(?:convex|@convex-dev)\//.test(text)
  || /\b(?:Base)?Convex(?:Http|React)?Client\b/.test(text)
  || /(?:from\s*|require\s*\()\s*['"](?:convex(?:\/|['"])|@convex-dev\/)/.test(text);
}
function files(root){return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(root,e.name)):/\.(?:js|mjs|html|css|json)$/.test(e.name)?[path.join(root,e.name)]:[]);}
function auditRuntime({local=false}={}){
 const artifacts=local
  ? ['app/accounts.bundle.js','backend/server.bundle.cjs','backend/worker.bundle.cjs']
  : [...files('public'),'backend/server.bundle.cjs','backend/worker.bundle.cjs','.worker-build/index.mjs'];
 const missing=artifacts.filter(f=>!fs.existsSync(f));
 if(missing.length)throw Error('Missing runtime artifacts. Run npm run build'+(local?'':':cloudflare')+' first: '+missing.join(', '));
 const bad=artifacts.filter(f=>hasConvexRuntime(fs.readFileSync(f,'utf8')));
 if(bad.length)throw Error('Convex runtime reference in deployment artifact(s): '+bad.join(', '));
 console.log('PASS '+artifacts.length+' deployment artifacts: no Convex client, runtime dependency, or endpoint');
}
if(require.main===module)auditRuntime({local:process.argv.includes('--local')});
module.exports={hasConvexRuntime,auditRuntime};
