const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const geometry=source.slice(source.indexOf('function elementPoint('),source.indexOf('function wirePoints('));
test('hidden socket targets the visible card edge instead of the screen origin',()=>{
 const hidden={getBoundingClientRect:()=>({left:0,top:0,width:0,height:0})};
 const card={querySelector:()=>hidden,getBoundingClientRect:()=>({left:360,top:240,right:880,width:520,height:180})};
 const sandbox={boardTop:()=>65,document:{querySelector:()=>null},cardEl:()=>card,screenPoint:()=>{throw Error('Unexpected fallback');}};
 vm.createContext(sandbox);vm.runInContext(geometry,sandbox);
 const point=sandbox.portPoint({id:'chat',x:100,y:100},true);
 assert.equal(point.x,348);assert.equal(point.y,239);
});
test('visible ports use their real center',()=>{
 const sandbox={boardTop:()=>65,};vm.createContext(sandbox);vm.runInContext(geometry,sandbox);
 const point=sandbox.elementPoint({getBoundingClientRect:()=>({left:400,top:280,width:10,height:24})});
 assert.equal(point.x,405);assert.equal(point.y,227);
});

test('panel chat wires stay anchored to the canvas placeholder',()=>{
 const placeholder={querySelector:()=>null,getBoundingClientRect:()=>({left:120,top:180,right:640,width:520,height:80})};
 const sandbox={boardTop:()=>65,document:{querySelector:()=>placeholder},cardEl:()=>{throw Error('Must not measure panel');}};
 vm.createContext(sandbox);vm.runInContext(geometry,sandbox);
 assert.equal(sandbox.portPoint({id:'chat'},true).x,108);
});
