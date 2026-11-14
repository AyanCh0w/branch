import {randomUUID} from 'node:crypto';
import {engine,pool,configured} from './service';
import {decode} from './codec';
import {expireJobs,failJobs} from './jobs';
const owner=randomUUID();let stopping=false;
async function tick(){
 // Never replay an uncertain paid request after a worker crash.
 await expireJobs(engine);
 const {rows}=await pool.query(`update branch_private.jobs set status='running',owner=$1,lease_until=now()+interval '60 seconds',attempts=attempts+1
 where id=(select id from branch_private.jobs where status='pending' and due_at<=now() order by due_at for update skip locked limit 1) returning *`,[owner]);
 const job=rows[0];if(!job)return false;
 const heartbeat=setInterval(()=>{pool.query("update branch_private.jobs set lease_until=now()+interval '60 seconds' where id=$1 and owner=$2 and status='running'",[job.id,owner]).catch(()=>{});},10000);
 try{await engine.call(job.function_name,decode(job.args),{},'action',true);await pool.query("update branch_private.jobs set status='complete',lease_until=null where id=$1 and owner=$2 and status='running'",[job.id,owner]);}
 catch{await failJobs(engine,"id=$1 and owner=$2 and status='running'",[job.id,owner],'Generation could not finish. Please retry.');}
 finally{clearInterval(heartbeat);}return true;
}
async function main(){if(!configured())throw Error('Configure Supabase before starting the worker.');process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});console.log('Branch Supabase worker started');while(!stopping){try{if(!await tick())await new Promise(r=>setTimeout(r,1000));}catch{console.error('Worker database unavailable; retrying');await new Promise(r=>setTimeout(r,5000));}}await pool.end();}
if(require.main===module)main().catch(()=>{console.error('Worker could not start. Check server environment.');process.exitCode=1;});
export {tick};
