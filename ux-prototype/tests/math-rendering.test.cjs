const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
function render(text){const dom=new JSDOM('<!doctype html>',{runScripts:'outside-only'});dom.window.eval(fs.readFileSync(path.join(__dirname,'../markdown.bundle.js'),'utf8'));const out=dom.window.document.createElement('div');out.innerHTML=dom.window.BranchMarkdown(text);return {dom,out};}
test('renders screenshot integration equation and all common math delimiters',()=>{
 const {dom,out}=render(String.raw`This comes from the product rule:
\[
(uv)' = u'v + uv'
\]
So,
\[
\int u\,dv = uv - \int v\,du
\]
Inline \(x_1^2\), $y$, and display:
$$
\frac{1}{2}
$$`);
 try{assert.equal(out.querySelectorAll('.katex').length,5);assert.equal(out.querySelectorAll('.katex-display').length,3);assert.equal(out.querySelectorAll('math').length,5);assert.match(out.querySelectorAll('annotation')[1].textContent,/\\int/);}finally{dom.window.close();}
});
test('preserves code, currency, links and safe incomplete streaming output',()=>{
 const {dom,out}=render('`\\(x\\)`\n\n```tex\n$$x$$\n```\n\nCosts $5 and $10. [source](https://example.com)\n\n\\[\\frac{1}{');
 try{assert.equal(out.querySelector('.katex'),null);assert.equal(out.querySelector('code').textContent,'\\(x\\)');assert.match(out.textContent,/Costs \$5 and \$10/);assert.equal(out.querySelector('a').rel,'noopener noreferrer');}finally{dom.window.close();}
});
test('math cannot inject active HTML or unsafe links and malformed formulas do not break replies',()=>{
 const {dom,out}=render(String.raw`\(\href{javascript:alert(1)}{click}\) \(\htmlStyle{position:fixed}{x}\) \(\frac{\) <img src=x onerror=alert(1)>`);
 try{assert.equal(out.querySelector('img,script,a,[onerror],[style*="fixed"]'),null);assert.match(out.textContent,/\\frac/);}finally{dom.window.close();}
});
