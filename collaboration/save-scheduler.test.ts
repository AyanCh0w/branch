import {it,expect,vi,afterEach} from 'vitest';
import {createSaveScheduler} from './save-scheduler';
afterEach(()=>vi.useRealTimers());
it('batches 600 keystrokes over a minute into at most 60 durable writes',async()=>{
 vi.useFakeTimers();let text='',stored='';const save=vi.fn(async()=>{stored=text;});
 const scheduler=createSaveScheduler({save});
 for(let i=0;i<600;i++){text+='x';scheduler.schedule();await vi.advanceTimersByTimeAsync(100);}
 expect(save.mock.calls.length).toBe(60);expect(stored).toBe(text);
 scheduler.cancel();
});
it('slow writes never overlap or immediately spin into another background write',async()=>{
 vi.useFakeTimers();let finish:()=>void=()=>{};
 const save=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const scheduler=createSaveScheduler({save});scheduler.schedule();await vi.advanceTimersByTimeAsync(1000);
 scheduler.schedule();await vi.advanceTimersByTimeAsync(5000);expect(save).toHaveBeenCalledTimes(1);
 finish();await vi.advanceTimersByTimeAsync(0);expect(save).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(999);expect(save).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);expect(save).toHaveBeenCalledTimes(2);finish();await vi.advanceTimersByTimeAsync(0);scheduler.cancel();
});
it('Send waits for an in-flight save and drains edits made during it immediately',async()=>{
 vi.useFakeTimers();let finish:()=>void=()=>{},text='first',stored='';
 const save=vi.fn(async()=>{const snapshot=text;if(save.mock.calls.length===1)await new Promise<void>(r=>{finish=r;});stored=snapshot;});
 const scheduler=createSaveScheduler({save});scheduler.schedule();await vi.advanceTimersByTimeAsync(1000);
 text='complete prompt';scheduler.schedule();let sent=false;const sending=scheduler.flush().then(()=>{sent=true;});
 expect(sent).toBe(false);finish();await sending;expect(stored).toBe('complete prompt');expect(save).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(5000);expect(save).toHaveBeenCalledTimes(2);scheduler.cancel();
});
it('save failures reach explicit callers instead of allowing Send or retry storms',async()=>{
 vi.useFakeTimers();const save=vi.fn(async()=>{throw Error('offline');});const scheduler=createSaveScheduler({save});
 scheduler.schedule();await vi.advanceTimersByTimeAsync(1000);await vi.advanceTimersByTimeAsync(10000);expect(save).toHaveBeenCalledTimes(1);
 await expect(scheduler.flush()).rejects.toThrow('offline');scheduler.cancel();
});
it('concurrent Send/blur drains both wait for the final durable write',async()=>{
 vi.useFakeTimers();let finish:()=>void=()=>{};
 const save=vi.fn(()=>new Promise<void>(r=>{finish=r;}));const scheduler=createSaveScheduler({save});
 scheduler.schedule();await vi.advanceTimersByTimeAsync(1000);scheduler.schedule();
 let a=false,b=false;const one=scheduler.flush().then(()=>{a=true;}),two=scheduler.flush().then(()=>{b=true;});
 finish();await vi.advanceTimersByTimeAsync(0);expect(save).toHaveBeenCalledTimes(2);expect(a).toBe(false);expect(b).toBe(false);
 finish();await Promise.all([one,two]);expect(a&&b).toBe(true);scheduler.cancel();
});
