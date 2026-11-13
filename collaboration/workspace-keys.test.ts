import {convexTest} from 'convex-test';
import {it,expect,vi,afterEach} from 'vitest';
import {registerCore,sessionIdentity} from '@convex-dev/auth/test';
import {registerPassword} from '@convex-dev/auth/components/password/test';
import {registerUsername} from '@convex-dev/auth/components/username/test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.ts');
afterEach(()=>vi.unstubAllEnvs());
it('retires custom keys without using saved ciphertext and still permits owner cleanup',async()=>{
 vi.stubEnv('CONVEX_CLOUD_URL','https://test.convex.cloud');vi.stubEnv('OPENAI_API_KEY','default-test-key');
 const t=convexTest(schema,modules);registerCore(t);registerPassword(t);registerUsername(t);
 const r=await t.mutation(api.auth.signUpWithUsernamePassword,{username:'owner',password:'unique-key-test-password-9384'});if(r.status!=='complete')throw Error();const owner=t.withIdentity(sessionIdentity(r.tokens));
 const boardId=await owner.mutation(api.library.create,{title:'Board'});
 await expect(owner.action(api.workspaceKeyActions.save,{key:'sk-old-custom-key-123456789'})).rejects.toThrow(/replaced/);
 await expect(t.action(api.workspaceKeyActions.save,{key:null})).rejects.toThrow();
 await owner.action(api.workspaceKeyActions.save,{key:null});expect(await t.action(internal.workspaceKeyActions.resolve,{boardId})).toBe('default-test-key');
});
