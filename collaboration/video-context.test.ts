import {convexTest} from 'convex-test';
import {it,expect,vi,afterEach} from 'vitest';
import schema from '../convex/schema';
import {api} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.ts');
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
it('Send requires pending captions, freezes them atomically and preserves the prompt on failure',async()=>{
 vi.useFakeTimers();vi.stubEnv('DEV_BRIDGE_SECRET','test');vi.stubEnv('ENABLE_DEVELOPMENT_BRIDGE','true');const t=convexTest(schema,modules);
 const a=await t.mutation(api.boards.developmentSession,{secret:'test',identityKey:'video-test',token:'video-test'}),auth={token:'video-test',boardId:a.boardId};
 const videoId='M7lc1UVf-VE',binding={source:'v',title:'Video',body:'Video URL',enabled:true,video:{id:videoId,included:false}};
 await t.mutation(api.boards.initialize,{...auth,title:'Test',nodes:[{id:'chat',type:'thread',title:'Chat',draft:'Summarize the video',messages:[],contexts:[binding]}]});
 const args={...auth,nodeKey:'chat',requestId:'send',expectedVersion:0};
 await expect(t.mutation(api.chat.send,args)).rejects.toThrow(/transcript/);
 expect((await t.query(api.boards.read,auth)).nodes[0].draft).toBe('Summarize the video');
 const runId=await t.mutation(api.chat.send,{...args,videoTranscripts:[{id:videoId,text:'[0:20] The exact point is turn off autoplay.',language:'en'}]});
 const run=await t.run(ctx=>ctx.db.get(runId));expect(run!.input.contexts[0].text).toContain('turn off autoplay');expect(run!.input.contexts[0].video.included).toBe(true);expect(run!.billedUserId).toBe(a.userId);
 const chat=(await t.query(api.boards.read,auth)).nodes[0];expect(chat.contexts[0].body).toContain('turn off autoplay');expect(chat.messages[0].context[0].body).toContain('turn off autoplay');expect(chat.draft).toBe('');
});
