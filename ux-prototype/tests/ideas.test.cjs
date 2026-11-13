const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(){
 const source={id:'source',x:100,y:100,width:380},state={nodes:[source]},ideaPreviews=new Map(),expandingIdeas=new Map(),sent=[];
 let uid=0;const panel={getBoundingClientRect:()=>({left:130,top:150}),querySelectorAll:selector=>selector==='[data-idea-prompt]'?[{dataset:{ideaPrompt:'1'},value:'Edited prompt 1'}]:[0,1,2].map(i=>({getBoundingClientRect:()=>({left:530,top:150+i*62})}))};
 const card={offsetWidth:380,offsetHeight:200,querySelector:()=>panel,querySelectorAll:()=>[],getAnimations:()=>[]};
 const ctx=vm.createContext({state,ideaPreviews,expandingIdeas,window:{},innerWidth:1400,camera:{x:0,z:1},reduced:{matches:true},BranchContext:{hasContent:()=>true,resolveContext:()=>[]},contextSnapshot:()=>({source:'source',body:'Frozen source'}),cardEl:()=>card,boardPoint:(x,y)=>({x,y}),nodeById:id=>state.nodes.find(n=>n.id===id),AbortController,clone:structuredClone,id:()=>String(++uid),remember(){},freePosition:(x,y)=>({x,y}),refreshCard(){},record(){},requestDraw(){},requestAnimationFrame(){},notify(){},send:n=>{sent.push(n);return new Promise(()=>{});},icon:()=>'',escapeHTML:String});
 const app=fs.readFileSync(require.resolve('../app.js'),'utf8');vm.runInContext(app.slice(app.indexOf('function expandIdeaButton'),app.indexOf('window.BranchHost=')),ctx);
 ctx.updateIdeaPreview=()=>{};ctx.preview={x:0,y:0,snapshot:{source:'source',body:'Frozen source'},ideas:[0,1,2].map(i=>({title:'Idea '+i,prompt:'Original',selected:true}))};ideaPreviews.set('source',ctx.preview);
 return {ctx,source,state,ideaPreviews,sent};
}
test('launch creates isolated frozen context branches and starts every Send without awaiting earlier responses',()=>{
 const {ctx,source,state,sent,ideaPreviews}=setup();ctx.launchIdeas(source);
 assert.equal(sent.length,3);assert.equal(new Set(sent.map(n=>n.y)).size,1);assert.ok(sent[0].x<sent[1].x&&sent[1].x<sent[2].x);assert.equal(state.nodes.length,4);assert.equal(ideaPreviews.size,0);
 assert.deepEqual(sent.map(n=>n.draft),['Original','Edited prompt 1','Original']);
 sent[0].contexts[0].body='Changed';assert.equal(sent[1].contexts[0].body,'Frozen source');
 ctx.launchIdeas(source);assert.equal(sent.length,3);
});
test('viewers cannot launch previewed ideas',()=>{
 const {ctx,source,state,sent}=setup();ctx.window.BoardShared={writable:false};ctx.launchIdeas(source);assert.equal(sent.length,0);assert.equal(state.nodes.length,1);
});
test('expansion validates results and leaves an inline retryable error without creating nodes',async()=>{
 const {ctx,source,state,ideaPreviews}=setup();ideaPreviews.clear();ctx.cardEl=()=>({querySelector:()=>({getBoundingClientRect:()=>({left:120,bottom:140,width:20})})});ctx.fetch=async()=>({ok:true,json:async()=>({ideas:[]})});
 await ctx.expandIdea(source);assert.equal(state.nodes.length,1);assert.match(ideaPreviews.get('source').error,/No usable ideas/);assert.equal(ctx.expandingIdeas.size,0);
});

test('short idea suggestions use low reasoning with no research tools',()=>{
 const {buildExpansionRequest,MODEL}=require('../server.cjs');
 const req=buildExpansionRequest({messages:[{role:'user',content:'Explore https://example.com'}]});
 assert.equal(req.model,MODEL);assert.equal(req.reasoning.effort,'low');assert.equal(req.tools,undefined);assert.equal(req.stream,false);
});
test('blank edited prompts do not launch branches',()=>{
 const {ctx,source,sent,state}=setup();ctx.preview.ideas[0].prompt=' ';ctx.launchIdeas(source);assert.equal(sent.length,0);assert.equal(state.nodes.length,1);
});

test('only selected topics send, preserving original topic and edited prompt indices',()=>{
 const {ctx,source,sent,state}=setup();ctx.preview.ideas[0].selected=false;ctx.preview.ideas[2].selected=false;ctx.preview.ideas[0].prompt='';ctx.launchIdeas(source);
 assert.equal(state.nodes.length,2);assert.equal(sent.length,1);assert.equal(sent[0].title,'Idea 1');assert.equal(sent[0].draft,'Edited prompt 1');
});
test('no selection creates no branches and retains the preview',()=>{
 const {ctx,source,sent,state,ideaPreviews}=setup();ctx.preview.ideas.forEach(idea=>idea.selected=false);ctx.launchIdeas(source);
 assert.equal(sent.length,0);assert.equal(state.nodes.length,1);assert.equal(ideaPreviews.size,1);
});
test('two nonadjacent choices launch only those branches',()=>{
 const {ctx,source,sent}=setup();ctx.preview.ideas[1].selected=false;ctx.launchIdeas(source);
 assert.deepEqual(sent.map(n=>n.title),['Idea 0','Idea 2']);
});
test('generated topics start unselected and remain editable',async()=>{
 const {ctx,source,ideaPreviews}=setup();ideaPreviews.clear();ctx.fetch=async()=>({ok:true,json:async()=>({ideas:[0,1,2].map(i=>({title:'Topic '+i,prompt:'Explore '+i}))})});
 await ctx.expandIdea(source);const preview=ideaPreviews.get(source.id);assert.ok(preview.ideas.every(i=>i.selected===false));
 const {JSDOM}=require('jsdom');const doc=new JSDOM(ctx.ideaPreviewMarkup(source)).window.document;
 assert.equal(doc.querySelectorAll('[data-select-idea]').length,3);assert.equal(doc.querySelectorAll('[data-edit-idea]').length,3);assert.equal(doc.querySelector('[data-launch-ideas]').disabled,true);
});
