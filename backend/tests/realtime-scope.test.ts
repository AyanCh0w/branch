import {it,expect,vi} from 'vitest';
import {Store} from '../store';
import {Engine} from '../engine';
it('shares repeated record reads within one transaction, without sharing mutable objects or later snapshots',async()=>{
 const sql={query:vi.fn(async()=>({rows:[{id:'users_one',collection:'users',created_at:1,data:{name:'Before',kind:'account'}}]}))};
 const store=new Store(sql);
 const [a,b]=await Promise.all([store.get('users_one'),store.get('users_one')]);
 expect(sql.query).toHaveBeenCalledTimes(1);a.name='changed';expect(b.name).toBe('Before');
 await new Store(sql).get('users_one');expect(sql.query).toHaveBeenCalledTimes(2);
 store.touch('users','users_one',{});await store.get('users_one');expect(sql.query).toHaveBeenCalledTimes(3);
});
it('sends one scoped invalidation per affected account with no record contents',async()=>{
 const sql={query:vi.fn(async()=>({rows:[{auth_id:'one'},{auth_id:'two'}]}))};
 const db=new Store(sql,true);db.touch('cursors','cursor_one',{boardId:'board',userId:'person',x:40,y:90});
 await new Engine({}).invalidate(db);
 expect(sql.query).toHaveBeenCalledTimes(2);
 const args=sql.query.mock.calls[1] as any;
 expect(args[0]).toContain('unnest');expect(args[1][0]).toEqual(['one','two']);
 expect(JSON.parse(args[1][1])).toEqual({collections:['cursors'],boards:['board'],teams:[]});
});
