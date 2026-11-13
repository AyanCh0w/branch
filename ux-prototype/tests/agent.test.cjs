const {test}=require('node:test'),assert=require('node:assert/strict');
const {nodeArgs,researchSources}=require('../../collaboration/agent.cjs');
const {place,dimensions}=require('../auto-layout.js');
test('automatic packing clears tall cards and arbitrarily many obstacles',()=>{
 const nodes=Array.from({length:30},(_,i)=>({x:0,y:i*700,type:'thread',layoutHeight:640}));
 const p=place(nodes,{x:0,y:0},440,300);assert.ok(p.y>nodes.at(-1).y+640);
 nodes.push({...p,type:'plan',width:440,layoutHeight:1000});const next=place(nodes,p,440,300);assert.ok(next.y>=p.y+1064);
 assert.equal(dimensions({type:'web',researchSource:true}).height,160);
});
test('tools validate canvas types and source provenance excludes unsafe links and duplicates',()=>{
 assert.throws(()=>nodeArgs({kind:'delete',title:'Oops',content:'',url:''}));
 assert.throws(()=>nodeArgs({kind:'website',title:'Oops',content:'',url:'javascript:alert(1)'}));
 assert.throws(()=>nodeArgs({kind:'website',title:'Oops',content:'',url:'https://user:pass@example.com'}));
 const sources=researchSources({output:[{type:'web_search_call',action:{sources:[{url:'https://example.com/team#x',title:'Team'},{url:'https://example.com/team'},{url:'javascript:bad'}]}},{type:'message',content:[{annotations:[{url:'https://example.com/judges',title:'Judges'}]}]}]});
 assert.deepEqual(sources,[{url:'https://example.com/team',title:'Team'},{url:'https://example.com/judges',title:'Judges'}]);
});
