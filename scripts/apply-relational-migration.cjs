// Preview by default. --apply makes a private backup, then runs the atomic DDL.
const fs = require('node:fs');
const path = require('node:path');
const {Client} = require('pg');
const cfg = require('../backend/config.cjs');
const entities = require('../backend/entities.json');
async function main() {
 const db = new Client({connectionString:cfg.database});
 await db.connect();
 try {
  const kind=(await db.query("select relkind from pg_class where oid='branch_private.records'::regclass")).rows[0].relkind;
  const counts=(await db.query('select collection,count(*)::int as count from branch_private.records group by collection order by collection')).rows;
  console.log(JSON.stringify({project:cfg.url,currentStorage:kind==='r'?'shared table':'relational view',entities:Object.keys(entities).length,counts}));
  if(kind==='r'&&process.argv.includes('--apply')) {
   await db.query('begin isolation level repeatable read read only');
   const backup={project:cfg.url,createdAt:new Date().toISOString()};
   for(const table of ['records','accounts','jobs']) backup[table]=(await db.query('select * from branch_private.'+table)).rows;
   backup.revisions=(await db.query('select * from public.branch_revisions')).rows;
   await db.query('commit');
   fs.mkdirSync('backups',{recursive:true,mode:0o700});
   const filename=path.join('backups','pre-relational-'+Date.now()+'.json');
   fs.writeFileSync(filename,JSON.stringify(backup),{mode:0o600,flag:'wx'});
   await db.query(fs.readFileSync('supabase/migrations/202611140002_relational_entities.sql','utf8'));
   console.log('Applied atomic migration; private backup: '+filename);
  } else if(kind==='r') return;
  const tables=(await db.query("select c.relname as name,c.relrowsecurity as rls from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='branch_private' and c.relkind='r' order by c.relname")).rows;
  for(const entity of Object.values(entities))if(!tables.some(t=>t.name===entity.table&&t.rls))throw Error('Missing protected table: '+entity.table);
  if(tables.some(t=>!t.rls))throw Error('Unprotected private table');
  const constraints=(await db.query("select contype,count(*)::int as count from pg_constraint where connamespace='branch_private'::regnamespace group by contype order by contype")).rows;
  const after=(await db.query('select collection,count(*)::int as count from branch_private.records group by collection order by collection')).rows;
  console.log(JSON.stringify({verified:true,tables,constraints,counts:after}));
 } finally {await db.end();}
}
main().catch(error=>{console.error('Migration failed:',error.message);process.exitCode=1;});
