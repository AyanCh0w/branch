import {test,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({pools:[] as any[]}));
vi.mock('pg',()=>({Pool:class {
 name:string;ended=false;
 constructor(options:any){this.name=options.connectionString;mocks.pools.push(this);}
 on(){} query(){return Promise.resolve({name:this.name});}end(){this.ended=true;return Promise.resolve();}
}}));
import {pool,withDatabase} from '../service';
test('concurrent request pools stay isolated and close even on failure',async()=>{
 let release:any;const barrier=new Promise<void>(r=>release=r);
 const first=withDatabase('first',async()=>{await barrier;return (await pool.query('select 1') as any).name;});
 const second=withDatabase('second',async()=>{expect((await pool.query('select 1') as any).name).toBe('second');release();throw Error('test failure');});
 const result=await Promise.allSettled([first,second]);
 expect(result[0]).toEqual({status:'fulfilled',value:'first'});expect(result[1].status).toBe('rejected');
 expect(mocks.pools).toHaveLength(2);expect(mocks.pools.every(p=>p.ended)).toBe(true);
});
