import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';

it('migrates existing data losslessly and enforces database constraints and privacy',async()=>{
 const pg=new PGlite();
 try {
  await pg.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql as 'select null::uuid';create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`);
  await pg.exec(readFileSync('supabase/migrations/202611140001_branch.sql','utf8'));
  const user={name:'Existing user',kind:'account'};
  const board={ownerId:'u',title:'Existing board',development:false,initialized:true,projectPlan:null};
  const node={boardId:'b',key:'note',data:{body:'original',nested:{keep:null}},textState:{$branch:'bytes',value:'AQID'},textVersion:0,createdBy:'u',updatedBy:'u',deleted:false};
  for(const [id,collection,data] of [['u','users',user],['b','boards',board],['n','nodes',node]]) await pg.query('insert into branch_private.records values($1,$2,123,$3)',[id,collection,JSON.stringify(data)]);
  await pg.query("insert into branch_private.accounts(auth_id,user_id,username) values('00000000-0000-4000-8000-000000000001','u','existing')");
  await pg.exec(readFileSync('supabase/migrations/202611140002_relational_entities.sql','utf8'));
  const rows=(await pg.query('select id,data from branch_private.records order by id')).rows as any[];
  expect(rows).toEqual([{id:'b',data:board},{id:'n',data:node},{id:'u',data:user}]);
  expect((await pg.query("select table_name from information_schema.tables where table_schema='branch_private' and table_type='BASE TABLE'")).rows.length).toBe(28);
  expect((await pg.query("select relname from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='branch_private' and c.relkind='r' and not c.relrowsecurity")).rows).toEqual([]);
  await expect(pg.query("insert into branch_private.boards(id,created_at,title,owner_id,development,initialized) values('bad',123,'orphan','missing',false,false)")).rejects.toThrow(/foreign key/);
  expect((await pg.query("select * from branch_private.record_ids where id='bad'")).rows).toHaveLength(0);
  await expect(pg.query("insert into branch_private.users(id,created_at,name,kind) values('bad',123,'bad','admin')")).rejects.toThrow(/check constraint/);
  await expect(pg.query('insert into branch_private.records values($1,$2,123,$3)',['n2','nodes',JSON.stringify(node)])).rejects.toThrow(/unique constraint/);
  await expect(pg.query("insert into branch_private.teams(id,created_at,name,owner_id) values('u',123,'duplicate ID','u')")).rejects.toThrow(/unique constraint/);
  await pg.query("update branch_private.boards set title='Edited through table' where id='b'");
  expect((await pg.query("select data->>'title' as title from branch_private.records where id='b'")).rows).toEqual([{title:'Edited through table'}]);
  await pg.query("update branch_private.records set data=jsonb_set(data,'{title}','\"Edited through app\"') where id='b'");
  expect((await pg.query("select title from branch_private.boards where id='b'")).rows).toEqual([{title:'Edited through app'}]);
  for(const role of ['anon','authenticated']) {
   await pg.exec('set role '+role);
   await expect(pg.query('select * from branch_private.users')).rejects.toThrow(/permission denied/);
   await expect(pg.query('select * from branch_private.records')).rejects.toThrow(/permission denied/);
   await pg.exec('reset role');
  }
 } finally {await pg.close();}
});
