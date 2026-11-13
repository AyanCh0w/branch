const test=require('node:test');const assert=require('node:assert/strict');
const {snapshotNode,resolveContext}=require('../context.js');
const plan=()=>({id:'plan',type:'plan',title:'Launch',body:'Launch on Friday.',revision:1});
function setup(){const p=plan(),a={id:'a',type:'thread',title:'Approach A',revision:2,messages:[{id:'m1',role:'user',text:'Use invitations.'},{id:'m2',role:'assistant',text:'Make links revocable.'}],contexts:[snapshotNode(p,[p])]};const b={id:'b',type:'thread',title:'Approach B',revision:1,messages:[{id:'b1',role:'user',text:'Private sibling content.'}],contexts:[snapshotNode(p,[p])]};return[p,a,b]}
test('branch inherits full upstream plan and parent transcript, never siblings',()=>{const nodes=setup(),snapshot=snapshotNode(nodes[1],nodes);const resolved=resolveContext([snapshot]);assert.deepEqual(resolved.map(c=>c.source),['plan','a']);assert.match(resolved[1].text,/Use invitations/);assert.match(resolved[1].text,/revocable/);assert.ok(!JSON.stringify(snapshot).includes('Private sibling'))});
test('later parent changes do not silently alter an existing branch',()=>{const nodes=setup(),snapshot=snapshotNode(nodes[1],nodes);nodes[0].body='Launch next month';nodes[1].messages.push({id:'m3',role:'user',text:'Later message'});assert.match(resolveContext([snapshot])[0].text,/Friday/);assert.ok(!JSON.stringify(snapshot).includes('Later message'))});
test('explicit side connection includes that branch and deduplicates shared ancestors',()=>{const nodes=setup();const direct=snapshotNode(nodes[1],nodes),side=snapshotNode(nodes[2],nodes);const resolved=resolveContext([direct,side]);assert.deepEqual(resolved.map(c=>c.source),['plan','a','b']);assert.match(resolved[2].text,/Private sibling/)});
test('message-level branch stops at the selected message',()=>{const nodes=setup(),snapshot=snapshotNode(nodes[1],nodes,{cutoff:'m1'});assert.match(snapshot.body,/Use invitations/);assert.ok(!snapshot.body.includes('revocable'));assert.equal(snapshot.cutoff,'m1')});
test('excluded full context keeps only an explicit excerpt',()=>{const nodes=setup(),snapshot=snapshotNode(nodes[1],nodes,{quote:'Use invitations.'});snapshot.enabled=false;assert.deepEqual(resolveContext([snapshot]).map(c=>({text:c.text,quote:c.quote})),[{text:'',quote:'Use invitations.'}])});
test('legacy explicit connection cycles terminate',()=>{const nodes=setup();nodes[1].contexts.push({source:'b',title:'B',revision:1,body:'B context',enabled:true});nodes[2].contexts.push({source:'a',title:'A',revision:1,body:'A context',enabled:true});const snapshot=snapshotNode(nodes[1],nodes);assert.ok(resolveContext([snapshot]).length<6)});

test('context affordances require content, not a title or unsent draft',()=>{
 const {hasContent}=require('../context.js');
 assert.equal(hasContent({type:'plan',body:'   ',title:'Named'}),false);
 assert.equal(hasContent({type:'thread',title:'Named',messages:[],draft:'Unsent',contexts:[]}),false);
 assert.equal(hasContent({type:'thread',messages:[],contexts:[{enabled:true,body:'Inherited source'}]}),false);
 assert.equal(hasContent({type:'thread',messages:[{text:'Sent message'}],contexts:[]}),true);
 assert.equal(hasContent({type:'media',source:'https://youtube.com/watch?v=M7lc1UVf-VE',videoId:'M7lc1UVf-VE'}),true);
});

test('prompt branches prefill the prompt and inherit only preceding messages',()=>{
 const {branchPayload}=require('../context.js');
 const chat={id:'chat',type:'thread',title:'Conversation',contexts:[],messages:[{id:'a',role:'assistant',text:'Earlier answer'},{id:'u',role:'user',text:'Try a different approach'},{id:'later',role:'assistant',text:'Later answer'}]};
 const result=branchPayload(chat,[chat],{cutoff:'u'});
 assert.equal(result.draft,'Try a different approach');
 assert.equal(result.context.body,'AI: Earlier answer');
 assert.equal(result.context.cutoff,'u');
});
test('selected text is excerpt context rather than a prefilled prompt or whole document',()=>{
 const {branchPayload}=require('../context.js');
 const node={id:'p',type:'plan',title:'Plan',body:'One thought. Another thought.'};
 const result=branchPayload(node,[node],{quote:'One thought.'});
 assert.equal(result.draft,'');
 assert.equal(result.context.body,'One thought.');
 assert.equal(result.context.excerptOnly,true);
});

test('video context includes a transcript only when one exists',()=>{
 const {textOf}=require('../context.js');
 const video={type:'media',mediaType:'video',title:'Video',source:'https://www.youtube.com/watch?v=abcdefghijk'};
 assert.equal(textOf(video),'Video\n'+video.source);
 assert.equal(textOf({...video,transcript:'Actual spoken words'}),'Video\n'+video.source+'\nActual spoken words');
});

test('empty response placeholders cannot branch even in a populated chat',()=>{
 const {canBranch}=require('../context.js');
 const chat={type:'thread',messages:[{id:'sent',text:'A question'},{id:'pending',text:'  '}]};
 assert.equal(canBranch(chat),true);
 assert.equal(canBranch(chat,'sent'),true);
 assert.equal(canBranch(chat,'pending'),false);
 assert.equal(canBranch(chat,'missing'),false);
 assert.equal(canBranch(null),false);
});

test('website context includes the author’s perspective without claiming extracted page text',()=>{
 const {textOf}=require('../context.js');
 const site={id:'hackathon',type:'web',title:'Hackathon',url:'https://hackathon.example',body:'I am participating, not organizing. Help me choose a project.'};
 assert.equal(textOf({...site,body:''}),site.url);
 const resolved=resolveContext([snapshotNode(site,[site])]);
 assert.match(resolved[0].text,/https:\/\/hackathon.example/);
 assert.match(resolved[0].text,/I am participating, not organizing/);
 assert.match(resolved[0].text,/not extracted website text/);
});
test('website note edits affect new context snapshots while previous branches stay frozen',()=>{
 const site={id:'site',type:'web',title:'Event',url:'https://event.example',body:'I am an attendee.',revision:1};
 const first=snapshotNode(site,[site]);
 site.body='I am a mentor.';site.revision++;
 const next=snapshotNode(site,[site]);
 assert.match(first.body,/I am an attendee/);
 assert.doesNotMatch(first.body,/mentor/);
 assert.match(next.body,/I am a mentor/);
 assert.equal(next.revision,2);
});

test('images and PDFs carry frozen attachments through branches, never into excerpt-only context',()=>{
 const {branchPayload}=require('../context.js');
 for(const [mime,kind] of [['image/png','image'],['application/pdf','pdf']]){
  const source={id:'asset',type:'upload',title:'File',asset:'local',storageId:'stored-original',mime,revision:1};
  const snap=snapshotNode(source,[source]);source.storageId='replacement';
  const chat={id:'chat',type:'thread',title:'Chat',contexts:[snap],messages:[{id:'m',role:'assistant',text:'Answer'}]};
  const inherited=resolveContext([snapshotNode(chat,[source,chat])]);
  assert.equal(inherited[0].attachment.storageId,'stored-original');assert.equal(inherited[0].attachment.kind,kind);
  snap.enabled=false;assert.equal(resolveContext([snap]).length,0);
  assert.equal(branchPayload(source,[source],{quote:'only this'}).context.attachment,undefined);
 }
 const image={id:'remote',type:'media',mediaType:'image',image:'https://example.com/photo.png',source:'https://example.com',title:'Photo'};
 assert.equal(resolveContext([snapshotNode(image,[image])])[0].attachment.url,image.image);
});
test('distinct excerpts of one source survive deduplication and video limitations are explicit',()=>{
 const p=plan();const a=snapshotNode(p,[p],{quote:'First'}),b=snapshotNode(p,[p],{quote:'Second'});
 assert.equal(resolveContext([a,b,a]).length,2);
 const video={id:'v',type:'media',mediaType:'video',title:'Video',source:'https://youtube.com/watch?v=abcdefghijk'};
 assert.match(resolveContext([snapshotNode(video,[video])])[0].availability,/no transcript/);
});
test('Responses receives typed visual content; unavailable files fail rather than silently becoming filenames',()=>{
 const {contextInput}=require('../../collaboration/context-input.cjs');
 const input=contextInput([{title:'Photo',text:'A photo',attachment:{kind:'image',url:'https://example.com/photo.png'}},{title:'Report',text:'A report',attachment:{kind:'pdf',url:'https://example.com/report.pdf'}}]);
 assert.deepEqual(input[0].content.filter(p=>p.type!=='input_text'),[{type:'input_image',image_url:'https://example.com/photo.png',detail:'auto'},{type:'input_file',file_url:'https://example.com/report.pdf'}]);
 assert.throws(()=>contextInput([{attachment:{kind:'pdf',asset:'local'}}]),/unavailable/);
 assert.throws(()=>contextInput([{attachment:{kind:'pdf',url:'file:///private/file'}}]),/unavailable/);
 const {webOptions}=require('../../collaboration/web-search.cjs');
 assert.equal(webOptions([{content:'Describe it'}],[{attachment:{url:'https://private-storage/file'}}]).tool_choice,'auto');
});
