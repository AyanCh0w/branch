import {test,expect,vi} from 'vitest';
import {harness} from './harness';
import {mutation,internalAction} from '../definitions';
import {v} from '../validation';

test('queue wake-up follows commit; notification failure leaves a durable pending job; rollback never notifies',async()=>{
 const h=await harness();
 try{
  const notify=vi.fn(async()=>{const jobs=await h.pool.query('select * from branch_private.jobs');expect(jobs.rows.length).toBe(1);throw Error('Queue unavailable');});
  h.engine.notifyJobs=notify;
  h.engine.functions={probe:{work:internalAction({args:{},handler:async()=>null}),schedule:mutation({args:{fail:v.boolean()},handler:async(ctx:any,a:any)=>{await ctx.scheduler.runAfter(0,'probe:work',{});if(a.fail)throw Error('Rollback');return 'scheduled';}})}};
  await expect(h.call({},'probe:schedule',{fail:true})).rejects.toThrow('Rollback');
  expect(notify).not.toHaveBeenCalled();expect((await h.pool.query('select * from branch_private.jobs')).rows).toHaveLength(0);
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try{expect(await h.call({},'probe:schedule',{fail:false})).toBe('scheduled');}finally{log.mockRestore();}
  expect(notify).toHaveBeenCalledTimes(1);
  expect((await h.pool.query('select status from branch_private.jobs')).rows[0].status).toBe('pending');
 }finally{await h.close();}
});
