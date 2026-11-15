const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
function boot({webgl=true,reduced=false,mobile=false,contrast=false,saved}={}) {
  const dom=new JSDOM('<div id="paper-background"></div><input id="paper-background-on" type="checkbox"><input id="paper-background-strength" type="range" min="0" max="100"><output id="paper-background-value"></output><p id="paper-background-status"></p><button id="nav-appearance-reset"></button>',{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window, frames=new Map();let id=0, visibility;
  w.matchMedia=query=>({matches:(query.includes('reduced-motion')&&reduced)||(query.includes('max-width')&&mobile)||(query.includes('prefers-contrast')&&contrast),addEventListener(){}});
  w.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};
  w.cancelAnimationFrame=id=>frames.delete(id);
  w.IntersectionObserver=class{constructor(cb){visibility=cb;}observe(){}};
  w.ResizeObserver=class{observe(){}};
  w.document.querySelector('#paper-background').getBoundingClientRect=()=>({width:1280,height:760});
  const gl=new Proxy({}, {get(_,key){if(key==='isContextLost')return()=>false;if(key==='getShaderParameter'||key==='getProgramParameter')return()=>true;return()=>({});}});
  w.HTMLCanvasElement.prototype.getContext=()=>webgl?gl:null;
  if(saved)w.localStorage.setItem('branch.paper-background.v1',JSON.stringify(saved));
  w.eval(fs.readFileSync(path.resolve(__dirname,'../landing-shader.mjs'),'utf8'));
  return {dom,w,frames,host:w.document.querySelector('#paper-background'),visibility};
}
test('WebGL-unavailable browsers retain the static material and working saved controls',()=>{
  const {dom,w,host,frames}=boot({webgl:false,saved:{enabled:false,amount:70}});
  try {
    assert.equal(host.dataset.renderer,'fallback');assert.equal(host.style.opacity,'0');assert.equal(frames.size,0);
    const toggle=w.document.querySelector('#paper-background-on');toggle.checked=true;toggle.dispatchEvent(new w.Event('change'));
    assert.equal(host.style.opacity,'0.7');assert.equal(frames.size,0);
    w.document.querySelector('#nav-appearance-reset').click();assert.equal(host.style.opacity,'0.45');
    assert.deepEqual(JSON.parse(w.localStorage.getItem('branch.paper-background.v1')),{enabled:true,amount:45});
  }finally{dom.window.close();}
});
test('reduced motion renders once without scheduling a continuous animation',()=>{
  const {dom,host,frames}=boot({reduced:true});
  try{assert.equal(host.dataset.renderer,'webgl');assert.equal(host.dataset.motion,'static');assert.equal(frames.size,0);assert.equal(host.querySelectorAll('path').length,28);}finally{dom.window.close();}
});
test('offscreen and disabled effects suspend rendering; returning resumes one loop',()=>{
  const {dom,w,frames,visibility}=boot();
  try{
    assert.equal(frames.size,1);visibility([{isIntersecting:false}]);assert.equal(frames.size,0);
    visibility([{isIntersecting:true}]);assert.equal(frames.size,1);visibility([{isIntersecting:true}]);assert.equal(frames.size,1);
    const toggle=w.document.querySelector('#paper-background-on');toggle.checked=false;toggle.dispatchEvent(new w.Event('change'));assert.equal(frames.size,0);
  }finally{dom.window.close();}
});

test('mobile scroll fades to a visible floor and restores full intensity at the top',()=>{
  const {dom,w,host}=boot({mobile:true,reduced:true});
  try{
    assert.equal(Number(host.style.opacity),.45);
    w.scrollY=200;w.dispatchEvent(new w.Event('scroll'));
    assert.ok(Number(host.style.opacity)<.45 && Number(host.style.opacity)>.26);
    w.scrollY=5000;w.dispatchEvent(new w.Event('scroll'));
    assert.ok(Math.abs(Number(host.style.opacity)-.261)<.00001);
    w.scrollY=0;w.dispatchEvent(new w.Event('scroll'));assert.equal(Number(host.style.opacity),.45);
    const toggle=w.document.querySelector('#paper-background-on');toggle.checked=false;toggle.dispatchEvent(new w.Event('change'));
    w.scrollY=5000;w.dispatchEvent(new w.Event('scroll'));assert.equal(host.style.opacity,'0');
  }finally{dom.window.close();}
});
test('high contrast overrides persistent mobile background',()=>{
  const {dom,w,host}=boot({mobile:true,contrast:true});
  try{w.scrollY=5000;w.dispatchEvent(new w.Event('scroll'));assert.equal(host.style.opacity,'0');}finally{dom.window.close();}
});

test('desktop background remains visible while scroll selects distinct scenes',()=>{
 const {dom,w,host,frames}=boot({reduced:true});
 try{
 assert.equal(host.dataset.scene,'hero');
 w.scrollY=900;w.dispatchEvent(new w.Event('scroll'));
 assert.equal(host.dataset.scene,'shared-work');assert.ok(Number(host.style.opacity)>.25);
 w.scrollY=2700;w.dispatchEvent(new w.Event('scroll'));
 assert.equal(host.dataset.scene,'quiet');assert.ok(Number(host.style.opacity)>.25);
 w.scrollY=0;w.dispatchEvent(new w.Event('scroll'));
 assert.equal(host.dataset.scene,'hero');assert.equal(frames.size,0);
 }finally{dom.window.close();}
});
