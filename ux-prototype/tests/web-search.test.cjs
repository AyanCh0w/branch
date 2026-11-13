const {test}=require('node:test');
const assert=require('node:assert/strict');
const {webOptions,citedText}=require('../../collaboration/web-search.cjs');
const {buildRequest,buildTitleRequest}=require('../server.cjs');
test('links require web lookup, ordinary prompts may search, titles never search',()=>{
 assert.equal(webOptions([{content:'Read https://example.com'}]).tool_choice,'required');
 assert.equal(webOptions([{content:'Suggest a project'}],[{text:'https://hackathon.example\nI am attending'}]).tool_choice,'required');
 assert.equal(webOptions([{content:'Hello'}]).tool_choice,'auto');
 const request=buildRequest({messages:[{role:'user',content:'Read https://example.com'}]});
 assert.deepEqual(request.tools,[{type:'web_search'}]);assert.equal(request.model,'gpt-5.4-mini');
 assert.equal(buildTitleRequest({text:'https://example.com'}).tools,undefined);
});
test('citations replace inline markers with safe clickable markdown and preserve prose',()=>{
 const response={output:[{type:'web_search_call'},{type:'message',content:[{type:'output_text',text:'Fact. [1] More.',annotations:[{type:'url_citation',start_index:6,end_index:9,url:'https://example.com/a(b)',title:'Example [source]'}]}]}]};
 assert.equal(citedText(response),'Fact. [Example  source ](https://example.com/a%28b%29) More.');
 response.output[1].content[0].annotations[0].url='javascript:alert(1)';assert.equal(citedText(response),'Fact. [1] More.');
 assert.equal(citedText({output:[{type:'message',content:[{type:'refusal',refusal:'Cannot help'}]}]}),'Cannot help');
});
test('reasoning slider and stream activity follow the API state',()=>{
 const {reasoningOptions,activityForEvent}=require('../../collaboration/web-search.cjs');
 assert.equal(reasoningOptions(0).effort,'high');assert.equal(reasoningOptions(1).effort,'medium');assert.equal(reasoningOptions(2).effort,'low');assert.equal(reasoningOptions(undefined).effort,'high');
 assert.equal(activityForEvent({type:'response.web_search_call.searching'}),'searching');
 assert.equal(activityForEvent({type:'response.web_search_call.completed'}),'thinking');
 assert.equal(activityForEvent({type:'response.output_item.added',item:{type:'reasoning'}}),'thinking');
 assert.equal(activityForEvent({type:'response.output_text.delta'}),'writing');
 assert.equal(activityForEvent({type:'response.completed'}),null);
 assert.equal(buildRequest({messages:[{role:'user',content:'Think'}],modelStage:0}).reasoning.effort,'high');
});
