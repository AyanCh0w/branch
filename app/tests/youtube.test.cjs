const {test}=require('node:test'),assert=require('node:assert/strict');
const {normalizeTranscript,getTranscript,publicError}=require('../../collaboration/youtube.cjs');
const {pendingVideoIds,hydrateVideos}=require('../video-context.js');
const {snapshotNode,branchPayload,resolveContext}=require('../context.js');
const {webOptions}=require('../../collaboration/web-search.cjs');
const id='M7lc1UVf-VE',source={id:'video',type:'media',mediaType:'video',videoId:id,title:'Video',source:'https://www.youtube.com/watch?v='+id};
const transcript={id,text:'[0:10] Use the iframe API.\n[1:20] Configure player parameters.',language:'en'};
test('caption normalization preserves timestamps, language and metadata and rejects empty/oversized results',()=>{
 const result=normalizeTranscript(id,{videoDetails:{title:'Player guide'},segments:[{text:' Hello\nworld ',offset:10.4,lang:'en'},{text:'One hour',offset:3605,lang:'en'}]});
 assert.equal(result.text,'[0:10] Hello world\n[1:00:05] One hour');assert.equal(result.language,'en');assert.equal(result.title,'Player guide');
 assert.throws(()=>normalizeTranscript(id,[]),/no readable/);assert.throws(()=>normalizeTranscript(id,[{text:'a'.repeat(120001),offset:0}]),/too long/);
});
test('retrieval validates IDs, coalesces concurrent loads and falls back to original language',async()=>{
 let calls=0;const provider=async(_,options)=>{calls++;if(options.lang){const e=Error();e.name='YoutubeTranscriptNotAvailableLanguageError';throw e;}return [{text:'Bonjour',offset:0,lang:'fr'}];};
 const [a,b]=await Promise.all([getTranscript('abcdefghijk',{provider}),getTranscript('abcdefghijk',{provider})]);assert.equal(calls,2);assert.deepEqual(a,b);assert.equal(a.language,'fr');
 await assert.rejects(getTranscript('http://localhost'),/valid/);assert.match(publicError({name:'YoutubeTranscriptVideoUnavailableError'}),/unavailable or restricted/);
});
test('pending and legacy video bindings gain captions once, while ready snapshots stay frozen',()=>{
 const pending=snapshotNode(source,[source]);assert.deepEqual(pendingVideoIds([pending]),[id]);
 const ready=hydrateVideos([pending],[transcript]);assert.match(ready[0].body,/iframe API/);assert.equal(ready[0].video.included,true);assert.equal(ready[0].availability,undefined);assert.ok(!pending.body.includes('iframe'));
 assert.deepEqual(hydrateVideos(ready,[{...transcript,text:'replacement'}]),ready);
 const legacy={source:'old',title:'Video',enabled:true,body:source.title+'\n'+source.source};assert.deepEqual(pendingVideoIds([legacy]),[id]);assert.match(hydrateVideos([legacy],[transcript])[0].body,/Configure/);
 assert.throws(()=>hydrateVideos([pending],[]),/not available/);
});
test('inherited video captions reach descendants; excluded sources and excerpt branches do not fetch',()=>{
 const pending=snapshotNode(source,[source]);const chat={id:'chat',type:'thread',title:'Chat',contexts:[pending],messages:[{id:'u',role:'user',text:'Summarize'}]};
 const branch=snapshotNode(chat,[source,chat]);const resolved=resolveContext(hydrateVideos([branch],[transcript]));assert.equal(resolved[0].video.included,true);assert.match(resolved[0].text,/player parameters/);
 assert.deepEqual(pendingVideoIds([{...branch,enabled:false}]),[]);assert.deepEqual(pendingVideoIds([branchPayload({...source,transcript:transcript.text},[source],{quote:'Use the iframe API.'}).context]),[]);
});
test('caption-backed video answers do not force a web search; ordinary websites still do',()=>{
 const video=resolveContext(hydrateVideos([snapshotNode(source,[source])],[transcript]))[0];
 assert.equal(webOptions([{content:'Summarize the video'}],[video]).tool_choice,'auto');
 assert.equal(webOptions([{content:'Summarize'}],[video,{text:'https://example.com'}]).tool_choice,'required');
 const {buildRequest}=require('../server.cjs');const request=buildRequest({messages:[{role:'user',content:'Summarize'}],contexts:[video]});assert.match(JSON.stringify(request.input),/iframe API/);assert.equal(request.tool_choice,'auto');
});
