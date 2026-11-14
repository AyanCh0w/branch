import {randomUUID} from 'node:crypto';
import {Store} from './store';
import {validateReferences} from './validation';
import {registry} from './registry';
import {encode,decode} from './codec';
import type {Definition} from './definitions';
export class Engine {
 constructor(public pool:any,public storage?:any,public functions:any=registry,public notifyJobs?:()=>Promise<void>){}
 resolve(name:string,kind?:string,internal=false):Definition {
  const [module,key,...rest]=name.split(':');
  const fn=Object.hasOwn(this.functions,module)&&Object.hasOwn(this.functions[module],key)?this.functions[module][key]:null;
  if(rest.length||!fn?.handler||!fn.kind||fn.internal&&!internal||kind&&fn.kind!==kind)throw Error('Unknown operation');
  return fn;
 }
 async call(name:string,args:any={},identity:any={},kind?:string,internal=false,context?:any):Promise<any>{
  name=String(name);const fn=this.resolve(name,kind,internal);fn.args.parse(args);
  if(context&&fn.kind!=='action'){
   if(fn.kind==='mutation'&&!context.db.writable)throw Error('Mutation from query');
   await validateReferences(context.db.sql,fn.args,args);
   return fn.handler(context,args);
  }
  if(fn.kind==='action'){await validateReferences(this.pool,fn.args,args);return fn.handler(this.context(null,identity),args);}
  for(let attempt=0;attempt<4;attempt++){
   const sql=await this.pool.connect();
   try{
    await sql.query(fn.kind==='query'?'begin isolation level repeatable read read only':'begin');
    // Coarse lock intentionally preserves existing cross-table atomic Send invariants.
    // Scope this by board only after lock-order/concurrency tests cover team revocation.
    if(fn.kind==='mutation')await sql.query("select id from branch_private.runtime_lock where id=1 for update");
    const ctx=this.context(new Store(sql,fn.kind==='mutation'),identity);
    await validateReferences(sql,fn.args,args);
    const value=await fn.handler(ctx,args);
    if(fn.kind==='mutation')await this.invalidate(ctx.db);
    await sql.query('commit');
    if(ctx.scheduledJobs.length&&this.notifyJobs){try{await this.notifyJobs();}catch{console.error('Job wake-up deferred to recovery scan');}}
    return value;
   }catch(error:any){await sql.query('rollback');if(error.code==='40001'&&attempt<3)continue;throw error;}
   finally{sql.release();}
  }
 }
 context(db:any,identity:any){
  const ctx:any={db,userId:identity.userId||null,authId:identity.authId||null,scheduledJobs:[]};
  const run=(kind:string)=>(ref:any,args:any)=>{
   const name=String(ref);
   if(name.startsWith('components:authUsername:public:'))return this.username(name.split(':').at(-1)!,args,db);
   return this.call(name,args,identity,kind,true,db?ctx:undefined);
  };
  ctx.runQuery=run('query');ctx.runMutation=run('mutation');ctx.runAction=run('action');
  ctx.scheduler={runAfter:async(delay:number,ref:any,args:any)=>{
   if(!db?.writable)throw Error('Scheduler requires transaction');
   const name=String(ref);this.resolve(name,'action',true);
   const id=randomUUID();await db.sql.query('insert into branch_private.jobs(id,function_name,args,due_at) values($1,$2,$3,$4)',[id,name,JSON.stringify(encode(args)),new Date(Date.now()+delay)]);ctx.scheduledJobs.push(id);return id;
  }};
  ctx.storage={getUrl:async(id:string)=>{const meta=await db.get(id);if(!meta?.path||!this.storage)return null;const {data,error}=await this.storage.from('branch-files').createSignedUrl(meta.path,3600);if(error)throw Error('File service unavailable');return data.signedUrl;}};
  return ctx;
 }
 async username(method:string,args:any,db:any){
  const sql=db?.sql||this.pool;
  if(method==='getUsername'){const r=await sql.query('select username from branch_private.accounts where user_id=$1',[args.userId]);return r.rows[0]?.username||null;}
  if(method==='getUserIdByUsername'){const r=await sql.query('select user_id from branch_private.accounts where username=$1',[args.username.normalize('NFKC').toLowerCase()]);return r.rows[0]?.user_id||null;}
  throw Error('Unknown directory operation');
 }
 async invalidate(db:any){
  if(!db.affectedUsers.size&&!db.affectedBoards.size&&!db.affectedTeams.size)return;
  const {rows}=await db.sql.query(`select distinct a.auth_id from branch_private.accounts a where a.user_id=any($1::text[]) or a.user_id in (
   select data->>'userId' from branch_private.records where collection in ('boardMembers','linkMembers') and data->>'boardId'=any($2::text[])
   union select data->>'ownerId' from branch_private.records where collection='boards' and id=any($2::text[])
   union select data->>'userId' from branch_private.records where collection='teamMembers' and (data->>'teamId'=any($3::text[]) or data->>'teamId' in (select data->>'teamId' from branch_private.records where collection='boards' and id=any($2::text[])))
  )`,[[...db.affectedUsers],[...db.affectedBoards],[...db.affectedTeams]]);
  for(const row of rows)await db.sql.query('insert into public.branch_revisions(user_id,revision) values($1,1) on conflict(user_id) do update set revision=branch_revisions.revision+1',[row.auth_id]);
 }
}
