const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('collaboration/live.js','utf8').replaceAll('export ','');
const {liveTextPreviews,openLiveBoard}=vm.runInNewContext(source+'\n({liveTextPreviews,openLiveBoard})',{URL,Date,Math,JSON,setTimeout,clearTimeout,setInterval,clearInterval,document:Object.assign(new EventTarget(),{hidden:false}),window:new EventTarget(),location:{href:'https://joinbranch.dev/'}});
test('typing appears before persistence without modifying canonical documents or local state',()=>{
 let time=100,editing=false;const node={id:'n',body:'saved',draft:'',title:'Card'},docs=new Map([['n',{epoch:0}]]),paint=[];
 const p=liveTextPreviews({host:{getState:()=>({nodes:[node]}),refreshText:n=>paint.push(n)},docs,tabId:'self',isEditing:()=>editing,now:()=>time});
 for(const text of ['a','ab','abc'])p.receive({type:'text',nodeKey:'n',field:'body',text,epoch:0,tabId:'peer',userId:'other'});
 assert.deepEqual(paint.map(n=>n.body),['a','ab','abc']);assert.equal(node.body,'saved');assert.equal(docs.get('n').epoch,0);
 time+=5000;p.render();assert.equal(paint.at(-1).body,'saved');
});
test('late previews never revive sent drafts, deleted cards or overwrite local typing',()=>{
 const node={id:'n',body:'',draft:'',title:'Card'},docs=new Map([['n',{epoch:1}]]),paint=[];let editing=false;
 const p=liveTextPreviews({host:{getState:()=>({nodes:[node]}),refreshText:n=>paint.push(n)},docs,tabId:'self',isEditing:()=>editing});
 const msg={type:'text',nodeKey:'n',field:'draft',text:'late',epoch:0,tabId:'peer',userId:'other'};p.receive(msg);assert.equal(paint.length,0);
 editing=true;p.receive({...msg,epoch:1});assert.equal(paint.length,0);editing=false;docs.delete('n');p.receive({...msg,epoch:1});assert.equal(paint.length,0);
});
test('a saved snapshot settles its preview; disconnect restores canonical content',()=>{
 const node={id:'n',body:'old',draft:'',title:'Card'},docs=new Map([['n',{epoch:0}]]),paint=[];
 const p=liveTextPreviews({host:{getState:()=>({nodes:[node]}),refreshText:n=>paint.push(n)},docs,tabId:'self',isEditing:()=>false});
 p.receive({type:'text',nodeKey:'n',field:'body',text:'new',epoch:0,tabId:'peer',userId:'other'});node.body='new';p.render();assert.equal(paint.at(-1).body,'new');
 p.receive({type:'text',nodeKey:'n',field:'body',text:'unsaved',epoch:0,tabId:'peer',userId:'other'});p.receive({type:'reset'});assert.equal(paint.at(-1).body,'new');assert.equal(node.body,'new');
});
test('connection credentials stay out of URLs and ready messages permit immediate character sends',()=>{
 let ws;class Socket{constructor(url){this.url=url;this.readyState=1;this.bufferedAmount=0;this.sent=[];ws=this;}send(x){this.sent.push(JSON.parse(x));}close(){this.readyState=3;}}
 const live=openLiveBoard({client:{session:{access_token:'private-token'}},scope:{boardId:'board',token:''},tabId:'tab',WebSocketClass:Socket});
 try{assert.ok(!ws.url.includes('private-token'));assert.equal(live.send({type:'text'}),false);ws.onopen();assert.equal(ws.sent[0].type,'auth');ws.onmessage({data:JSON.stringify({type:'ready'})});
 for(const text of ['a','ab','abc'])assert.equal(live.send({type:'text',text}),true);assert.deepEqual(ws.sent.slice(1).map(m=>m.text),['a','ab','abc']);
 }finally{live.close();}
});
