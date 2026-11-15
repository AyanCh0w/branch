const test=require('node:test'),assert=require('node:assert/strict');
const {normalizePaths,normalizeAreas,covers,overlap,overlapping}=require('../work-scope.js');
const context=require('../context.js');

test('paths are normalized, deduplicated and reduced to the broadest prefix',()=>{
 assert.deepEqual(normalizePaths(['./convex/auth.ts','convex//auth.ts/','\\app\\context.js','app','../etc/passwd','',null,'a/./b']),['app','convex/auth.ts']);
 assert.equal(normalizePaths(Array.from({length:60},(_,i)=>'dir'+i)).length,40);
 assert.deepEqual(normalizeAreas(['Auth',' auth ','Billing & Plans','x'.repeat(50),'']),['auth','billing-plans']);
});
test('prefixes match whole segments only',()=>{
 assert.ok(covers('app','app/context.js'));assert.ok(covers('app','app'));
 assert.ok(!covers('app','apps/web'));assert.ok(!covers('app/context.js','app'));
});
test('overlap reports the more specific shared paths and shared areas',()=>{
 assert.deepEqual(overlap({paths:['convex'],areas:['auth']},{paths:['convex/auth.ts','app'],areas:['auth','billing']}),{paths:['convex/auth.ts'],areas:['auth'],any:true});
 assert.equal(overlap({paths:['app/context.js'],areas:[]},{paths:['app/coding.js'],areas:['auth']}).any,false);
});
test('only other people\'s open work collides',()=>{
 const mine={id:'a',userId:'me',status:'active',paths:['app'],areas:[]};
 const others=[{id:'b',userId:'me',status:'active',paths:['app'],areas:[]},{id:'c',userId:'you',status:'done',paths:['app'],areas:[]},{id:'d',userId:'you',status:'idle',paths:['app/x.js'],areas:[]},mine];
 assert.deepEqual(overlapping(mine,others).map(r=>r.other.id),['d']);
 assert.deepEqual(overlapping({...mine,status:'done'},others),[]);
});
test('a work card\'s context text carries its status, scope and latest updates',()=>{
 const plan={id:'p',type:'plan',title:'Auth',body:'Goal',revision:3,workItem:true,workStatus:'active',workOwner:{name:'Maria'},workScope:{paths:['convex/auth.ts'],areas:['auth']},workLatest:[{kind:'decision',text:'Leases last 60s'}]};
 const text=context.textOf(plan);
 assert.match(text,/^Goal\n\nWork status: active · Maria\nTouches: convex\/auth\.ts\nAreas: auth\n/);assert.match(text,/- \[decision\] Leases last 60s/);
 assert.equal(context.textOf({type:'plan',body:'Plain note'}),'Plain note');
});
test('followed bindings re-snapshot a changed source; excerpts and unchanged sources stay frozen',()=>{
 const plan={id:'p',type:'plan',title:'Auth',body:'New body',revision:3};
 const binding={id:'b1',source:'p',title:'Auth',body:'Old body',revision:2,enabled:false,follow:true};
 const [fresh]=context.followContext([binding],[plan]);
 assert.deepEqual({id:fresh.id,body:fresh.body,revision:fresh.revision,enabled:fresh.enabled,follow:fresh.follow},{id:'b1',body:'New body',revision:3,enabled:false,follow:true});
 assert.equal(context.followContext([{...binding,follow:false}],[plan])[0].body,'Old body');
 assert.equal(context.followContext([{...binding,quote:'Old',excerptOnly:true}],[plan])[0].body,'Old body');
 assert.equal(context.followContext([{...binding,cutoff:'m1'}],[plan])[0].body,'Old body');
 const same={...binding,revision:3};assert.equal(context.followContext([same],[plan])[0],same);
 assert.equal(context.followContext([{...binding,source:'gone'}],[plan])[0].body,'Old body');
});
