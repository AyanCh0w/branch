import {test,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {Engine} from '../engine';
import {mutation} from '../definitions';
import {guardConnection} from '../connection';

test('a checked-out socket failure rejects safely without committing or replaying a mutation',async()=>{
 const sql=Object.assign(new EventEmitter(),{query:vi.fn(async()=>({rows:[]})),release:vi.fn()});
 const pool={connect:vi.fn(async()=>sql)};
 const handler=vi.fn(async()=>{sql.emit('error',Object.assign(Error('private connection details'),{client:{password:'private-test'}}));return 'unsafe result';});
 const engine=new Engine(pool,undefined,{probe:{work:mutation({args:{},handler})}});
 await expect(engine.call('probe:work',{}, {},'mutation')).rejects.toThrow('Database connection interrupted');
 expect(pool.connect).toHaveBeenCalledTimes(1);expect(handler).toHaveBeenCalledTimes(1);
 expect(sql.query.mock.calls.flat()).not.toContain('commit');
 expect(sql.release).toHaveBeenCalledWith(expect.objectContaining({message:'Database connection interrupted'}));
 expect(sql.listenerCount('error')).toBe(0);
});

test('rollback failure discards the connection and retains a safe error',async()=>{
 const sql=Object.assign(new EventEmitter(),{query:vi.fn(async()=>{throw Error('private socket details');}),release:vi.fn()});
 const connection=guardConnection(sql);await connection.rollback();
 expect(()=>connection.assertHealthy()).toThrow('Database connection interrupted');
 connection.release();expect(sql.release).toHaveBeenCalledWith(connection.failure);
 expect(sql.listenerCount('error')).toBe(0);
});
