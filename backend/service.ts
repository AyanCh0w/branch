import {Pool} from 'pg';
import {createClient} from '@supabase/supabase-js';
import {createHash,randomUUID} from 'node:crypto';
import {Engine} from './engine';
import {Store} from './store';
import config from './config.cjs';
export const configured=()=>!!(config.url&&config.key&&config.secret&&config.database);
export const pool=new Pool({connectionString:config.database,max:8,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
export const admin=config.url&&config.secret?createClient(config.url,config.secret,{auth:{persistSession:false,autoRefreshToken:false}}):null;
export const engine=new Engine(pool,admin?.storage);
export const publicConfig=()=>({provider:'supabase',url:config.url,publishableKey:config.key,legacy:[]});
export async function identity(token=''){
 if(!token)return {};
 if(!admin)throw Error('Account service unavailable');
 const {data,error}=await admin.auth.getUser(token);
 if(error||!data.user)throw Error('Sign in again');
 const {rows}=await pool.query('select user_id from branch_private.accounts where auth_id=$1',[data.user.id]);
 if(!rows[0])throw Error('Account migration is required');
 return {userId:rows[0].user_id,authId:data.user.id};
}
export const tokenFrom=(req:any)=>/^Bearer (\S+)$/.exec(req.headers.authorization||'')?.[1]||'';
export function requestClient(req:any){const verified=identity(tokenFrom(req));return Object.fromEntries(['query','mutation','action'].map(kind=>[kind,async(name:string,args:any={})=>engine.call(name,args,await verified,kind)])) as any;}
const username=(s:any)=>{if(typeof s!=='string')throw Error('Use a username');const u=s.trim().normalize('NFKC').toLowerCase();if(!/^[a-z0-9_-]{3,64}$/.test(u))throw Error('Use 3–64 letters, numbers, underscores or dashes');return u;};
export const loginEmail=(u:string)=>createHash('sha256').update(u).digest('hex')+'@accounts.branch.invalid';
export async function rateLimit(bucket:string,limit:number,windowSeconds:number){
 const {rows}=await pool.query(`insert into branch_private.rate_limits(bucket,window_start,count) values($1,now(),1)
 on conflict(bucket) do update set count=case when rate_limits.window_start<now()-$2::double precision*interval '1 second' then 1 else rate_limits.count+1 end,
 window_start=case when rate_limits.window_start<now()-$2::double precision*interval '1 second' then now() else rate_limits.window_start end returning count`,[bucket,windowSeconds]);
 if(rows[0].count>limit)throw Error('Too many attempts. Please try again later.');
}
export async function authenticate(action:string,a:any,ip:string){
 if(!admin)throw Error('Account service unavailable');
 await rateLimit('auth:'+createHash('sha256').update(ip).digest('hex'),30,900);
 const auth=createClient(config.url!,config.key!,{auth:{persistSession:false,autoRefreshToken:false}}).auth;
 if(action==='refresh'){const {data,error}=await auth.refreshSession({refresh_token:a.refreshToken});if(error||!data.session)throw Error('Session expired');return {kind:'rotated',tokens:{accessToken:data.session.access_token,refreshToken:data.session.refresh_token}};}
 const u=username(a.username),email=loginEmail(u);if(typeof a.password!=='string'||a.password.length>512)throw Error('Check your password');
 if(action==='signup'){
  if(a.password.length<12)throw Error('Use at least 12 characters for your password');
  const {rows}=await pool.query('select 1 from branch_private.accounts where username=$1',[u]);if(rows.length)throw Error('That username is taken');
  const {data,error}=await admin.auth.admin.createUser({email,password:a.password,email_confirm:true});
  if(error||!data.user)throw Error('Could not create account. Check your details or try signing in.');
  const sql=await pool.connect();
  try{await sql.query('begin');await sql.query('select id from branch_private.runtime_lock where id=1 for update');const db=new Store(sql,true);const id=await db.insert('users',{name:'',kind:'account'});await sql.query('insert into branch_private.accounts(auth_id,user_id,username) values($1,$2,$3)',[data.user.id,id,u]);await sql.query('insert into public.branch_revisions(user_id) values($1)',[data.user.id]);await sql.query('commit');}
  catch(error){await sql.query('rollback');await admin.auth.admin.deleteUser(data.user.id);throw Error('Could not finish account creation. Try again.');}
  finally{sql.release();}
 }else if(action!=='signin')throw Error('Unknown authentication action');
 const {data,error}=await auth.signInWithPassword({email,password:a.password});if(error||!data.session)throw Error('Check your username and password');
 return {status:'complete',session:data.session,tokens:{accessToken:data.session.access_token,refreshToken:data.session.refresh_token}};
}
export async function upload(req:any,res:any,url:URL){
 const ticket=url.searchParams.get('ticket')||'',cap=url.searchParams.get('cap')||'';
 const hash=createHash('sha256').update(cap).digest('hex');
 const {rows}=await pool.query("select * from branch_private.records where id=$1 and collection='uploadTickets'",[ticket]);const row=rows[0]?.data;
 if(!row||row.hash!==hash||row.expiresAt<Date.now()||row.used)throw Error('Upload expired');
 const permission=await engine.call('library:permission',{boardId:row.boardId,token:''},{userId:row.userId},'query');if(!permission||permission.role==='viewer')throw Error('Board access denied');
 // Atomically consume the capability before reading bytes. Failed upload can be retried with a new ticket.
 const used=await pool.query("update branch_private.records set data=jsonb_set(data,'{used}','true') where id=$1 and data->>'used'='false' returning id",[ticket]);if(!used.rows.length)throw Error('Upload expired');
 const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>25*1024*1024)throw Error('File exceeds 25 MB');chunks.push(chunk);}
 const id='_storage_'+randomUUID().replaceAll('-',''),path=row.boardId+'/'+id,mime=String(req.headers['content-type']||'application/octet-stream');
 const {error}=await admin!.storage.from('branch-files').upload(path,Buffer.concat(chunks),{contentType:mime,upsert:false});if(error)throw Error('Upload failed');
 try{await pool.query("insert into branch_private.records(id,collection,created_at,data) values($1,'_storage',$2,$3)",[id,Date.now(),JSON.stringify({path,size,contentType:mime,ticket:row.fileTicket,boardId:row.boardId,userId:row.userId})]);}
 catch(error){await admin!.storage.from('branch-files').remove([path]);throw error;}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({storageId:id}));
}
