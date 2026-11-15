import {beforeEach,expect,test,vi} from 'vitest';
const mocks=vi.hoisted(()=>({signIn:vi.fn(),createUser:vi.fn(),getUser:vi.fn(),account:vi.fn()}));
vi.mock('../config.cjs',()=>({default:{url:'https://example.supabase.co',key:'public-test',secret:'private-test',database:'mock-database'}}));
vi.mock('pg',()=>({Pool:class {on(){} async query(sql:string){return {rows:sql.startsWith('select user_id')?mocks.account():[{count:1}]};}}}));
vi.mock('@supabase/supabase-js',async original=>({...await original<typeof import('@supabase/supabase-js')>(),createClient:()=>({auth:{getUser:mocks.getUser,signInWithPassword:mocks.signIn,admin:{createUser:mocks.createUser}}})}));
import {authenticate,loginEmail} from '../service';
import {route} from '../http';
beforeEach(()=>{vi.clearAllMocks();mocks.signIn.mockResolvedValue({data:{session:{access_token:'test-access',refresh_token:'test-refresh'}},error:null});});
test.each(['member@example.com','first last','ordinary_user'])(
 'existing %s username reaches password authentication',async name=>{
  const result=await authenticate('signin',{username:' '+name.toUpperCase()+' ',password:'known-test-password'},'test');
  expect(mocks.signIn).toHaveBeenCalledWith({email:loginEmail(name),password:'known-test-password'});
  expect(result.status).toBe('complete');
 });
test('legacy username support never bypasses password checks',async()=>{
 mocks.signIn.mockResolvedValue({data:{session:null},error:{message:'invalid'}});
 await expect(authenticate('signin',{username:'member@example.com',password:'wrong'},'test')).rejects.toThrow('Check your username and password');
});
test.each(['member@example.com','first last'])('new accounts retain username restrictions: %s',async name=>{
 await expect(authenticate('signup',{username:name,password:'known-test-password'},'test')).rejects.toThrow('3–64');
 expect(mocks.createUser).not.toHaveBeenCalled();expect(mocks.signIn).not.toHaveBeenCalled();
});

async function checkSavedSession(){
 const result={status:0,body:{}};
 const req={method:'POST',headers:{authorization:'Bearer test-access','content-type':'application/json'},body:{kind:'query',name:'accounts:me'}};
 const res={writeHead(status:number){result.status=status;},end(body:string){result.body=JSON.parse(body);}};
 await route(req,res,new URL('https://example.test/api/backend'));
 return result;
}
test.each(['user_not_found','session_not_found'])('reports a deleted Supabase session (%s) as unauthorized',async code=>{
 mocks.getUser.mockResolvedValue({data:{user:null},error:{status:403,code}});
 expect(await checkSavedSession()).toEqual({status:401,body:{error:'Sign in again'}});
 expect(mocks.account).not.toHaveBeenCalled();
});
test('reports a missing Branch account as unauthorized',async()=>{
 mocks.getUser.mockResolvedValue({data:{user:{id:'test-user'}},error:null});
 mocks.account.mockReturnValue([]);
 expect(await checkSavedSession()).toEqual({status:401,body:{error:'Account migration is required'}});
});
test('auth service failures do not invalidate the session',async()=>{
 mocks.getUser.mockResolvedValue({data:{user:null},error:{status:503}});
 expect(await checkSavedSession()).toEqual({status:503,body:{error:'Account service unavailable'}});
});
