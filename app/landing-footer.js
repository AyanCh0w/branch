// A local, decorative connection canvas. No tracking or network requests.
(() => {
  const host = document.getElementById('footer-playground');
  if (!host) return;
  const canvas = host.querySelector('canvas');
  const button = host.querySelector('button');
  const ctx = canvas.getContext('2d');
  if (!ctx) { button.hidden = true; return; }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const step = 24, lifetime = 2000;
  let width = 1, height = 1, frame = 0, visible = true, previous = null;
  let nodes = new Map(), edges = [];
  const snap = n => Math.round((n - 12) / step) * step + 12;
  const key = p => `${p.x}:${p.y}`;
  const point = (x, y) => ({x: snap(x), y: snap(y)});
  function stop() { cancelAnimationFrame(frame); frame = 0; }
  function clear() { stop(); nodes.clear(); edges = []; previous = null; ctx.clearRect(0,0,width,height); }
  function add(p, time) {
    if (p.x < 0 || p.y < 0 || p.x > width || p.y > height - 68) return false;
    nodes.delete(key(p)); nodes.set(key(p), {...p, time});
    while (nodes.size > 160) nodes.delete(nodes.keys().next().value);
    return true;
  }
  function connect(a, b, time) {
    if (!add(b,time)) return;
    if (a && key(a)!==key(b)) edges.push({a,b,time});
    if (edges.length>180) edges.splice(0,edges.length-180);
  }
  function paint(time) {
    frame = 0;
    if (!visible || document.hidden) return;
    ctx.clearRect(0,0,width,height);
    const color = '242,244,248';
    const alpha = t => reduced.matches ? .85 : Math.max(0, 1-(time-t)/lifetime);
    edges = edges.filter(edge=>alpha(edge.time)>0);
    for (const edge of edges) {
      ctx.strokeStyle=`rgba(${color},${alpha(edge.time)*.65})`; ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(edge.a.x,edge.a.y);ctx.lineTo(edge.b.x,edge.b.y);ctx.stroke();
    }
    for (const [id,p] of nodes) {
      const a=alpha(p.time);
      if(a<=0){nodes.delete(id);continue;}
      const size=10+4*a;
      ctx.fillStyle=`rgba(${color},${a})`;
      ctx.beginPath();ctx.roundRect(p.x-size/2,p.y-size/2,size,size,4);ctx.fill();
    }
    if(nodes.size && !reduced.matches) frame=requestAnimationFrame(paint);
    else if(!nodes.size) host.dataset.engaged='false';
  }
  function wake() {
    host.dataset.engaged='true';
    if(!frame && visible && !document.hidden) {
      if(reduced.matches) paint(performance.now());
      else frame=requestAnimationFrame(paint);
    }
  }
  function pattern(x,y) {
    if(reduced.matches) clear();
    const now=performance.now();
    const center=point(Math.max(60,Math.min(width-60,x)),Math.max(60,Math.min(height-140,y)));
    add(center,now);
    // Three short branches echo shared context feeding parallel conversations.
    for(const [dx,dy] of [[-2,-2],[2,-1],[1,2]]) {
      const elbow=point(center.x+dx*step,center.y);
      const tip=point(elbow.x,center.y+dy*step);
      connect(center,elbow,now);connect(elbow,tip,now);
    }
    wake();
  }
  function resize() {
    const rect=host.getBoundingClientRect();width=rect.width;height=rect.height;
    const ratio=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.max(1,Math.round(height*ratio));
    ctx.setTransform(ratio,0,0,ratio,0,0);clear();
  }
  function local(event) {const r=host.getBoundingClientRect();return point(event.clientX-r.left,event.clientY-r.top);}
  function trace(event) {
    if(event.target.closest('button') || (event.pointerType==='touch' && !previous)) return;
    const p=local(event),now=performance.now();
    if(previous && key(previous)===key(p)) return;
    if(reduced.matches) {nodes.clear();edges=[];}
    if(previous) {
      // Fill skipped grid cells even during a fast mouse movement.
      const count=Math.min(40,Math.ceil(Math.hypot(p.x-previous.x,p.y-previous.y)/step));
      let from=previous;
      for(let i=1;i<=count;i++) {
        const next=point(previous.x+(p.x-previous.x)*i/count,previous.y+(p.y-previous.y)*i/count);
        connect(from,next,now);from=next;
      }
    } else add(p,now);
    previous=p;wake();
  }
  host.addEventListener('pointerdown',event=>{
    if(event.target.closest('button') || !event.isPrimary) return;
    const p=local(event);previous=p;
    if(event.pointerType==='touch') pattern(p.x,p.y);else trace(event);
  },{passive:true});
  host.addEventListener('pointermove',trace,{passive:true});
  // Vertical touch scrolling is browser-owned; never preventDefault or capture it.
  for(const name of ['pointerleave','pointercancel','pointerup']) host.addEventListener(name,()=>{previous=null;},{passive:true});
  button.addEventListener('click',()=>pattern(width*.5,height*.4));
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(!visible) clear();});
  observer.observe(host);
  new ResizeObserver(resize).observe(host);
  reduced.addEventListener('change',clear);
  new MutationObserver(()=>{stop();paint(performance.now());}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  document.addEventListener('visibilitychange',()=>{if(document.hidden) clear();});
  window.addEventListener('pagehide',clear);
  resize();
})();
