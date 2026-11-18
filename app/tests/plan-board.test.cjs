const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const L=require('../plan-layout.js');
const root=path.join(__dirname,'..');

const plan={id:'plan-main',type:'plan',visualPlan:true,x:100,y:200,width:420,plan:{goal:'Launch a taco truck.',steps:[
 {id:'menu',title:'Define the menu',status:'done',note:''},{id:'hosts',title:'Line up hosts',status:'working',note:'List 10 hosts.'},{id:'permits',title:'Get permits',status:'blocked',note:''}],log:[]}};
plan.body=plan.planBody=L.planText(plan.plan);
function card(id,step,seq,extra={}){const brief={kind:'finding',summary:'A short takeaway about '+id+'.',points:['First point','Second point'],step,text:'',at:1,by:'Agent',...extra};brief.text=L.cardText(brief);return {id,type:'plan',title:id,body:brief.text,width:340,x:0,y:0,brief,lane:{plan:'plan-main',role:'card',seq}};}
const source=(id,parent,seq)=>({id,type:'web',title:id,url:'https://example.com/'+id,width:300,x:0,y:0,sourceNote:'Why it matters.',lane:{plan:'plan-main',role:'source',parent,seq}});

test('lanes follow the plan’s step order without overlapping, and sources sit beside their card',()=>{
 const members=[card('late','permits',1),source('s1','late',2),source('s2','late',3),card('early','menu',4),card('middle','hosts',5),card('loose',null,6),source('s3','early',7)];
 const positions=L.layout(plan,members);
 const at=id=>positions.get(id),height=id=>L.memberHeight(members.find(n=>n.id===id));
 assert.deepEqual(['early','middle','late','loose'].map(id=>at(id).x),Array(4).fill(100+420+L.SIZE.column));
 assert.ok(at('early').y<at('middle').y&&at('middle').y<at('late').y&&at('late').y<at('loose').y);
 assert.equal(at('early').y,200);
 assert.equal(at('s1').x,at('late').x+340+L.SIZE.column);assert.equal(at('s1').y,at('late').y);
 assert.ok(at('s2').y>=at('s1').y+height('s1')+L.SIZE.sourceRow);
 const boxes=[...positions].map(([id,p])=>({id,x:p.x,y:p.y,r:p.x+members.find(n=>n.id===id).width,b:p.y+height(id)}));
 for(const a of boxes)for(const b of boxes)if(a.id<b.id)assert.ok(!(a.x<b.r&&b.x<a.r&&a.y<b.b&&b.y<a.b),a.id+' overlaps '+b.id);
 // The row after a tall source stack starts below the stack, not below the card.
 assert.ok(at('loose').y>=at('s2').y+height('s2'));
});

test('a card a person moved is left alone and keeps its sources beside it',()=>{
 const moved={...card('moved','menu',1),x:3000,y:900,lane:{plan:'plan-main',role:'card',seq:1,pinned:true}};
 const members=[moved,source('s1','moved',2),card('other','hosts',3)];
 const positions=L.layout(plan,members);
 assert.equal(positions.has('moved'),false);
 assert.deepEqual(positions.get('s1'),{x:3000+340+L.SIZE.column,y:900});
 assert.equal(positions.get('other').y,200);
 assert.deepEqual(L.groupMembers(plan,[plan,...members]).map(n=>n.id),['plan-main','s1','other']);
 assert.deepEqual(L.groupMembers(members[2],[plan,...members]).map(n=>n.id),['other']);
 assert.deepEqual(L.groupMembers(moved,[plan,...members]).map(n=>n.id),['moved','s1']);
});

test('plain-text fallbacks stay short and a new plan starts clear of existing cards',()=>{
 assert.equal(L.planText(plan.plan),'Launch a taco truck.\n\n1. [x] Define the menu\n2. [~] Line up hosts\n   List 10 hosts.\n3. [!] Get permits');
 assert.equal(L.cardText({summary:'Takeaway.',points:['One','Two']}),'Takeaway.\n• One\n• Two');
 assert.deepEqual(L.progress(plan.plan),{total:3,done:1,working:1,blocked:1});
 assert.deepEqual(L.origin([]),{x:80,y:140});
 const start=L.origin([{x:0,y:300,type:'thread'},{x:900,y:40,type:'plan',width:380}]);
 assert.deepEqual(start,{x:900+380+240,y:40});
});

test('the canvas renders a checklist, short typed cards and compact sources, escaping agent text',()=>{
 const dom=new JSDOM('<!doctype html><body><div id="cards"></div></body>',{runScripts:'outside-only'}),w=dom.window;
 for(const script of ['icons.js','auto-layout.js','plan-layout.js','plan-board.js'])w.eval(fs.readFileSync(path.join(root,script),'utf8'));
 const evil='<img src=x onerror=alert(1)>';
 const finding=card('city','permits',1,{summary:'Three approvals '+evil,points:['Police permit '+evil],detail:'Long reasoning.',sources:['src']});
 const edited={...card('edited','menu',2),body:'A person rewrote this.'};
 const site={...source('src','city',3),sourceNote:'Checklist '+evil};
 const video={id:'vid',type:'media',mediaType:'video',videoId:'aqz-KE-bpKQ',width:300,lane:{plan:'plan-main',role:'source',step:'menu',seq:4}};
 const handEdited={...plan,id:'plan-typed',body:'typed by a person'};
 w.eval('var state='+JSON.stringify({nodes:[plan,finding,edited,site,video,handEdited]})+';function messageHTML(t){return "<p>"+t.replace(/</g,"&lt;")+"</p>";}');
 const B=w.BranchPlanBoard,html=n=>B.markup(n);
 const outline=html(plan);
 assert.match(outline,/class="plan-steps"/);assert.equal((outline.match(/class="plan-step"/g)||[]).length,3);
 assert.match(outline,/1 of 3 done · 1 in progress · 1 blocked/);
 assert.match(outline,/data-plan-step="permits"[^]*?linked card/);
 assert.match(outline,/data-step-port="menu"/);
 const brief=html(finding);
 assert.match(brief,/data-brief-kind="finding"/);assert.match(brief,/Step 3/);assert.match(brief,/data-brief-details/);
 assert.ok(!brief.includes('<img'),'agent text is escaped');assert.match(brief,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.ok(!brief.includes('Long reasoning.'),'detail stays collapsed until opened');
 assert.match(html(edited),/class="brief-edited"[^]*A person rewrote this\./);
 const compact=html(site);
 assert.match(compact,/example\.com/);assert.match(compact,/href="https:\/\/example\.com\/src"/);assert.ok(!compact.includes('<img'));
 // Videos keep the native player card; a plan a person typed into falls back to a normal note.
 assert.equal(html(video),'');assert.equal(html(handEdited),'');
 assert.equal(B.cardClass(plan),'plan-outline-card');assert.match(B.cardClass(site),/source-compact/);
 assert.equal(B.overviewType(finding),'Finding');assert.equal(B.overviewType(plan),'Plan');
 assert.equal(B.moveMembers(plan).map(n=>n.id).join(),'plan-main,city,edited,src,vid');
 assert.equal(B.moveMembers(site),null);
});

test('a board plan is separate cards: plan, steps and items, with folding, budgets and source chips',()=>{
 const dom=new JSDOM('<!doctype html><body><div id="cards"></div></body>',{runScripts:'outside-only'}),w=dom.window;
 for(const script of ['icons.js','auto-layout.js','plan-layout.js','plan-board.js'])w.eval(fs.readFileSync(path.join(root,script),'utf8'));
 const board={...plan,plan:{...plan.plan,format:2,log:[{at:1,by:'Claude Code · Alex',text:'Plan created'}]}};
 const item=(id,step,kind,extra={})=>card(id,step,1,{kind,rev:1,sources:[],...extra});
 const stepCard=(step,title)=>({id:'step-'+step,type:'plan',title,body:'',x:0,y:0,width:340,stepCard:{plan:'plan-main',step},lane:{plan:'plan-main',role:'step'}});
 const evil='<img src=x onerror=alert(1)>';
 const cards=[item('q','hosts','question'),item('d','hosts','decision',{sources:[{kind:'website',title:'City code '+evil,url:'https://example.com/code'},{kind:'website',title:'Bad',url:'javascript:alert(1)'}]}),
  ...[1,2,3,4].map(i=>item('f'+i,'hosts','finding')),item('old','hosts','question',{closed:{reason:'answered'}}),item('done-card','menu','finding'),item('stray','gone','finding')];
 const steps=[stepCard('menu','Define the menu'),stepCard('hosts','Line up hosts'),stepCard('permits','Get permits'),stepCard('','Unsorted')];
 w.eval('var state='+JSON.stringify({nodes:[board,...steps,...cards]})+';function messageHTML(t){return "<p>"+t+"</p>";}');
 const B=w.BranchPlanBoard,node=id=>w.eval('state.nodes').find(n=>n.id===id);
 // The plan card is the summary: goal, progress, the two views and Organize. No steps inside it.
 const head=B.markup(node('plan-main'));
 assert.equal(B.cardClass(node('plan-main')),'plan-board-card');
 assert.match(head,/1 of 3 done · 1 in progress · 1 blocked/);assert.match(head,/data-plan-view="outline"/);assert.match(head,/data-organize/);
 assert.ok(!head.includes('pb-item'));assert.match(head,/Needs organizing/);
 // Each step is its own card with its status, counts and what it can show.
 const hosts=B.markup(node('step-hosts'));
 assert.match(B.cardClass(node('step-hosts')),/pb-step-card/);
 assert.match(hosts,/Step 2 · In progress/);assert.match(hosts,/1 decision · 1 question · 4 findings/);
 assert.ok(!/Show \d+ more/.test(hosts));assert.match(hosts,/Show 1 closed/);assert.match(hosts,/data-follow-step="hosts"/);
 // An open step shows every open card; only closed cards and finished steps are folded away.
 const hidden=id=>B.embedded(node(id));
 assert.deepEqual(['q','d','f1','f2','f3','f4','old'].map(hidden),[false,false,false,false,false,false,true]);
 assert.equal(hidden('done-card'),true);assert.match(B.markup(node('step-menu')),/Show 1 card/);
 // An open question or risk under a finished step stays visible; resolved ones fold away with the step.
 w.eval("state.nodes.push("+JSON.stringify(item('menu-q','menu','question'))+","+JSON.stringify(item('menu-r','menu','risk',{closed:{reason:'closed'}}))+")");
 assert.equal(hidden('menu-q'),false);assert.equal(hidden('menu-r'),true);assert.equal(hidden('done-card'),true);
 // A card whose step is gone shows under Unsorted, and that step card only appears when needed.
 assert.equal(hidden('stray'),false);assert.equal(hidden('step-'),false);
 // An item is its own card; agent text is escaped and unsafe links are not links.
 const decision=B.markup(node('d'));
 assert.match(B.cardClass(node('d')),/pb-item-card/);assert.match(decision,/data-brief-kind="decision"/);
 assert.ok(!decision.includes('<img'));
 // The plan, a step and an item each move on their own; unmoved ones are placed by the browser, not saved.
 assert.equal(B.moveMembers(node('plan-main')),null);
 assert.equal(B.managed(node('d')),true);assert.equal(B.managed(node('step-hosts')),true);assert.equal(B.managed(node('plan-main')),false);
 assert.equal(B.managed({...node('d'),lane:{...node('d').lane,pinned:true}}),false);
 const check=w.BranchPlanLayout.health(node('plan-main'),w.eval('state.nodes'));
 assert.equal(check.issues.map(i=>i.rule).join(),'home');
 assert.ok(w.BranchPlanLayout.similarity('County health permit costs','County permit cost')>=.6);
 assert.ok(w.BranchPlanLayout.similarity('Zoning clearance','Police permit fee')<.6);
});
