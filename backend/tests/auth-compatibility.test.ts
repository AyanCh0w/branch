import {beforeEach,expect,test,vi} from 'vitest';
const mocks=vi.hoisted(()=>({signIn:vi.fn(),createUser:vi.fn()}));
vi.mock('../config.cjs',()=>({default:{url:'https://example.supabase.co',key:'public-test',secret:'private-test'}}));
vi.mock('pg',()=>({Pool:class {on(){} async query(){return {rows:[{count:1}]};}}}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({auth:{signInWithPassword:mocks.signIn,admin:{createUser:mocks.createUser}}})}));
import {authenticate,loginEmail} from '../service';
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
