const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function renderWith(renderer){
 const context=vm.createContext({window:{BranchMarkdown:renderer},console:{warn(){}}});
 vm.runInContext(source.split('\n').find(line=>line.startsWith('const escapeHTML=')),context);
 const start=source.indexOf('function messageHTML(text)');
 vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);
 return context.messageHTML;
}
test('shared messages remain readable and escaped when the markdown bundle is missing or broken',()=>{
 for(const renderer of [undefined,{},()=>{throw Error('Renderer unavailable');}]){
  const render=renderWith(renderer);
  assert.equal(render('<script>alert("x")</script>\nSecond line'),'&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;<br>Second line');
  assert.equal(render(null),'');
 }
});
test('available markdown renderer formats shared messages',()=>{
 assert.equal(renderWith(text=>'<p>'+text+'</p>')('Hello'),'<p>Hello</p>');
});
