// Dry-run by default. Run against an empty, migrated Supabase project.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const config=require('../backend/config.cjs');
const {Pool}=require('pg');const {createClient}=require('@supabase/supabase-js');
const root=path.resolve(process.argv[2]||'backups/convex-export');const apply=process.argv.includes('--apply');
function read(name){const file=path.join(root,name,'documents.jsonl');return fs.existsSync(file)?fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse):[];}
function transform(v){if(v&&typeof v==='object'&&!Array.isArray(v)){if(Object.keys(v).length===1&&v.$bytes!==undefined)return {$branch:'bytes',value:v.$bytes};if(v.$integer||v.$float)throw Error('Unsupported numeric export type; inspect before migration');return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,transform(x)]));}return Array.isArray(v)?v.map(transform):v;}
const schema=require('../backend/schema.bundle.cjs').default;
function validationValue(v){if(Array.isArray(v))return v.map(validationValue);if(v&&typeof v==='object'){if(Object.keys(v).length===1&&v.$bytes!==undefined)return Uint8Array.from(Buffer.from(v.$bytes,'base64')).buffer;return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,validationValue(x)]));}return v;}
const skipped=new Set(['_tables','_components','_storage']);
async function main(){
 const collections=fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&!skipped.has(e.name)).map(e=>e.name);
 const ids=new Map(),references=[];for(const collection of collections){if(!schema[collection])throw Error('Unknown source collection: '+collection);for(const row of read(collection)){const {_id,_creationTime,...data}=row;if(ids.has(_id))throw Error('Duplicate source ID');ids.set(_id,collection);schema[collection].validator.parse(validationValue(data));references.push(...schema[collection].validator.references(validationValue(data)));}}
 for(const r of references)if(ids.has(r.id)&&ids.get(r.id)!==r.table)throw Error('Invalid source ID reference');
 const users=read('users'),usernames=read('_components/authUsername/usernames'),passwords=read('_components/authPassword/passwords');
 const accounts=users.filter(u=>u.kind==='account').map(u=>{const n=usernames.find(n=>n.userId===u._id),p=passwords.find(p=>p.userId===u._id);if(!n||!p||!/^\$argon2(?:id|i)\$|^\$2[aby]\$/.test(p.passwordHashPHC))throw Error('Missing or unsupported account hash; migration stopped');return {userId:u._id,username:n.usernameNormalized||n.username.toLowerCase(),hash:p.passwordHashPHC};});
 const counts=Object.fromEntries(collections.map(c=>[c,read(c).length]));const files=read('_storage');
 console.log(JSON.stringify({mode:apply?'apply':'dry-run',records:counts,accounts:accounts.length,files:files.length,warning:'Existing login sessions are intentionally not migrated; users sign in again.'},null,2));
 if(!apply)return;
 if(!config.url||!config.secret||!config.database)throw Error('Supabase server environment missing');
 const pool=new Pool({connectionString:config.database,max:2});const admin=createClient(config.url,config.secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const manifestFile=path.join(root,'supabase-import-manifest.json');const manifest=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):{project:config.url,accounts:{},files:{},complete:false};
 if(manifest.project!==config.url)throw Error('Manifest belongs to another project');
 const save=()=>fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2),{mode:0o600});
 if(manifest.complete)throw Error('This snapshot was already imported. Do not overwrite newer edits.');
 try{
  const existing=await pool.query('select count(*)::int as count from branch_private.records');if(existing.rows[0].count)throw Error('Target is not empty; refusing to overwrite records');
  for(const a of accounts){if(manifest.accounts[a.userId])continue;const email=crypto.createHash('sha256').update(a.username).digest('hex')+'@accounts.branch.invalid';const {data,error}=await admin.auth.admin.createUser({email,email_confirm:true,password_hash:a.hash});if(error||!data.user)throw Error('Account import failed; no credentials printed. Check the private manifest before retrying.');manifest.accounts[a.userId]=data.user.id;save();}
  for(const f of files){if(manifest.files[f._id])continue;const ticket=read('fileUploads').find(t=>t.storageId===f._id);if(!ticket)throw Error('Unregistered storage file needs review');const objectPath=ticket.boardId+'/'+f._id;const bytes=fs.readFileSync(path.join(root,'_storage',f._id));if(bytes.length!==f.size)throw Error('File size mismatch');const {error}=await admin.storage.from('branch-files').upload(objectPath,bytes,{contentType:f.contentType||'application/octet-stream',upsert:false});if(error)throw Error('Storage import failed');manifest.files[f._id]=objectPath;save();}
  const sql=await pool.connect();try{
   await sql.query('begin');await sql.query('select id from branch_private.runtime_lock where id=1 for update');
   for(const c of collections){
    if(['sessions','editors','cursors','boardPresence','chatgptTransactions'].includes(c))continue;
    for(const source of read(c)){const {_id,_creationTime,...raw}=source;const data=transform(raw);
     if(c==='runs'&&['queued','streaming'].includes(data.status)){data.status='failed';data.error='Interrupted by backend migration; retry after signing in.';}
     if(c==='nodes'&&data.data?.activeRun){delete data.data.activeRun;delete data.data.activity;}
     await sql.query('insert into branch_private.records(id,collection,created_at,data) values($1,$2,$3,$4)',[_id,c,_creationTime,JSON.stringify(data)]);
    }
   }
   for(const f of files)await sql.query("insert into branch_private.records(id,collection,created_at,data) values($1,'_storage',$2,$3)",[f._id,f._creationTime,JSON.stringify({path:manifest.files[f._id],size:f.size,contentType:f.contentType})]);
   for(const a of accounts){const authId=manifest.accounts[a.userId];await sql.query('insert into branch_private.accounts(auth_id,user_id,username) values($1,$2,$3)',[authId,a.userId,a.username]);await sql.query('insert into public.branch_revisions(user_id) values($1)',[authId]);}
   await sql.query('commit');manifest.complete=true;save();
  }catch(e){await sql.query('rollback');throw e;}finally{sql.release();}
  const count=await pool.query('select collection,count(*)::int as count from branch_private.records group by collection order by collection');console.log(JSON.stringify({imported:count.rows,accounts:accounts.length,files:files.length}));
 }finally{await pool.end();}
}
main().catch(e=>{console.error(e.code?'Database operation failed; details suppressed.':e.message);process.exitCode=1;});
