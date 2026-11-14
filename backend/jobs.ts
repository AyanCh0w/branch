import {decode} from './codec';
import {Store} from './store';
import type {Engine} from './engine';

// The job and its visible run must fail in the same transaction. Otherwise a
// worker crash between writes could leave the canvas generating forever.
export async function failJobs(engine:Engine, where:string, values:any[], message:string) {
 const sql=await engine.pool.connect();
 try {
  await sql.query('begin');
  await sql.query('select id from branch_private.runtime_lock where id=1 for update');
  const {rows}=await sql.query(`update branch_private.jobs set status='failed',error=$${values.length+1},lease_until=null where ${where} returning args`,[...values,message]);
  const db=new Store(sql,true),ctx=engine.context(db,{});
  for(const row of rows) {
   const args=decode(row.args);
   if(args.runId)await engine.call('chat:append',{runId:args.runId,text:'',error:message},{},'mutation',true,ctx);
  }
  await engine.invalidate(db);
  await sql.query('commit');
  return rows.length;
 } catch(error) { await sql.query('rollback'); throw error; }
 finally { sql.release(); }
}
export const expireJobs=(engine:Engine)=>failJobs(engine,
 "status='running' and lease_until<now()",[],
 'Generation was interrupted. Review the partial response before retrying.');
