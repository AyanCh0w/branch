import {pool,configured} from './service';
import {tick} from './runner';
let stopping=false;
async function main(){if(!configured())throw Error('Configure Supabase before starting the worker.');process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});console.log('Branch Supabase worker started');while(!stopping){try{if(!await tick())await new Promise(r=>setTimeout(r,1000));}catch{console.error('Worker database unavailable; retrying');await new Promise(r=>setTimeout(r,5000));}}await pool.end();}
if(require.main===module)main().catch(()=>{console.error('Worker could not start. Check server environment.');process.exitCode=1;});
export {tick};
