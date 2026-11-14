import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Engine} from '../engine';
import {Store} from '../store';
export async function harness(){
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql as 'select null::uuid';create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);
 await pg.exec(readFileSync('supabase/migrations/202611140001_branch.sql','utf8'));
 // PGlite is single-connection. Queue transactions rather than interleave BEGINs.
 let previous=Promise.resolve();
 const pool:any={query:(...a:any[])=>pg.query(...a as [string,any[]]),connect:async()=>{let release:any;const current=new Promise<void>(r=>release=r),wait=previous;previous=previous.then(()=>current);await wait;return {query:(...a:any[])=>pg.query(...a as [string,any[]]),release};}};
 const engine=new Engine(pool,{from:()=>({createSignedUrl:async(path:string)=>({data:{signedUrl:'https://storage.example/'+path}})})});
 async function account(username:string){const authId=randomUUID();const db=new Store(pool,true);const userId=await db.insert('users',{name:username,kind:'account'});await pool.query('insert into branch_private.accounts(auth_id,user_id,username) values($1,$2,$3)',[authId,userId,username]);return {authId,userId};}
 return {pg,pool,engine,account,call:(identity:any,name:string,args:any={},kind='mutation')=>engine.call(name,args,identity,kind),close:()=>pg.close()};
}
