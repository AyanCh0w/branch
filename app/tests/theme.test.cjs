const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),script=fs.readFileSync(path.join(root,'theme.js'),'utf8');
function boot(saved,systemDark=false,blocked=false){
 const dom=new JSDOM('<meta name="theme-color"><select data-appearance><option>system</option><option>dark</option><option>light</option></select>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
 const media={matches:systemDark,addEventListener(_,cb){this.change=cb;}};w.matchMedia=()=>media;
 if(saved)w.localStorage.setItem('branch-appearance',saved);
 if(blocked)Object.defineProperty(w,'localStorage',{get(){throw Error('unavailable');}});
 w.eval(script);return {dom,w,media};
}
test('appearance follows system initially and applies before DOM ready',()=>{const {dom,w,media}=boot(null,true);assert.equal(w.document.documentElement.dataset.theme,'dark');media.matches=false;media.change();assert.equal(w.document.documentElement.dataset.theme,'light');dom.window.close();});
test('manual choice persists and ignores system changes',()=>{const {dom,w,media}=boot('light',true);assert.equal(w.document.documentElement.dataset.theme,'light');w.BranchTheme.set('dark');assert.equal(w.localStorage.getItem('branch-appearance'),'dark');media.matches=false;media.change();assert.equal(w.document.documentElement.dataset.theme,'dark');assert.equal(w.document.querySelector('select').value,'dark');assert.equal(w.document.querySelector('meta').content,'#17191d');dom.window.close();});
test('selector and cross-tab changes stay synchronized',()=>{const {dom,w}=boot();const select=w.document.querySelector('select');select.value='dark';select.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(w.BranchTheme.get(),'dark');w.dispatchEvent(new w.StorageEvent('storage',{key:'branch-appearance',newValue:'light'}));assert.equal(select.value,'light');w.dispatchEvent(new w.StorageEvent('storage',{key:null}));assert.equal(w.BranchTheme.get(),'system');dom.window.close();});
test('unavailable storage and invalid preferences safely use system appearance',()=>{for(const blocked of [false,true]){const {dom,w}=boot('invalid',true,blocked);assert.equal(w.BranchTheme.get(),'system');assert.equal(w.document.documentElement.dataset.theme,'dark');assert.doesNotThrow(()=>w.BranchTheme.set('light'));dom.window.close();}});
test('dark palette text exceeds WCAG AA contrast on opaque UI surfaces',()=>{
 const css=fs.readFileSync(path.join(root,'theme.css'),'utf8').split('}')[0],tokens=Object.fromEntries([...css.matchAll(/--theme-([\w-]+):\s*(#[\da-f]{6});/g)].map(m=>[m[1],m[2]]));
 const lum=h=>{const c=h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
 for(const fg of ['ink','muted','accent','danger','success','on-dark'])for(const bg of ['canvas','surface','raised','control','accent-surface'])assert.ok((lum(tokens[fg])+.05)/(lum(tokens[bg])+.05)>=4.5,`${fg} on ${bg}`);
 assert.ok((lum(tokens['on-dark'])+.05)/(lum(tokens['accent-solid'])+.05)>=4.5);
});
