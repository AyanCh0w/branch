// A local, decorative connection canvas. No tracking or network requests.
(() => {
  const host = document.getElementById('footer-playground');
  if (!host) return;
  const canvas = host.querySelector('canvas');
  const button = host.querySelector('button');
  const ctx = canvas.getContext('2d');
  if (!ctx) { button.hidden = true; return; }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const step = 32, hold = 500, removalInterval = 50;
  const footer = host.closest('.site-footer');
  const toneToggle = document.querySelector('[data-footer-tone-toggle]');
  function setTone(tone) {
    if (footer) footer.dataset.footerTone = tone;
    toneToggle?.setAttribute('aria-pressed', String(tone === 'dark'));
  }
  try { setTone(localStorage.getItem('branch-footer-tone') === 'light' ? 'light' : 'dark'); } catch { setTone('dark'); }
  toneToggle?.addEventListener('click', () => {
    const tone = footer.dataset.footerTone === 'dark' ? 'light' : 'dark';
    setTone(tone);
    try { localStorage.setItem('branch-footer-tone', tone); } catch {}
    if (nodes.size) wake();
  });
  let lastRemoval = 0;
  let width = 1, height = 1, frame = 0, visible = true, previous = null, touchStart = null;
  let nodes = new Map(), edges = [];
  const snap = n => Math.round((n - 16) / step) * step + 16;
  const key = p => `${p.x}:${p.y}`;
  const point = (x, y) => ({x: snap(x), y: snap(y)});
  function stop() { cancelAnimationFrame(frame); frame = 0; }
  function clear() { stop(); nodes.clear(); edges = []; previous = null; touchStart = null; host.dataset.engaged='false'; lastRemoval = 0; ctx.clearRect(0,0,width,height); }
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
    const color = footer?.dataset.footerTone === 'dark' ? '126,165,230' : '70,111,181';
    // A short hold, then ordered retraction from the oldest point. No blanket fade.
    if (!reduced.matches) {
      for (const [id,p] of nodes) {
        const due = Math.max(p.time + hold, lastRemoval + removalInterval);
        if (time < due) break;
        nodes.delete(id); lastRemoval = due;
      }
    }
    edges = edges.filter(edge=>nodes.has(key(edge.a)) && nodes.has(key(edge.b)));
    for (const edge of edges) {
      ctx.strokeStyle=`rgba(${color},${.58})`; ctx.lineWidth=1; ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(edge.a.x,edge.a.y);ctx.lineTo(edge.b.x,edge.b.y);ctx.stroke();
    }
    for (const [id,p] of nodes) {
      const radius=5;
      ctx.fillStyle=`rgba(${color},${.95})`;
      ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();
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
    if(event.target.closest('button')) return;
    if(event.pointerType==='touch') {
      if(touchStart && Math.hypot(event.clientX-touchStart.x,event.clientY-touchStart.y)>10) touchStart=null;
      return;
    }
    const p=local(event),now=performance.now();
    if(previous && key(previous)===key(p)) return;
    if(reduced.matches) {nodes.clear();edges=[];}
    if(previous) {
      // Fill skipped grid cells even during a fast mouse movement.
      const count=Math.min(40,Math.ceil(Math.hypot(p.x-previous.x,p.y-previous.y)/step));
      let from=previous;
      for(let i=1;i<=count;i++) {
        const next=point(previous.x+(p.x-previous.x)*i/count,previous.y+(p.y-previous.y)*i/count);
        if(from.x!==next.x && from.y!==next.y) {
          const corner={x:next.x,y:from.y};connect(from,corner,now);from=corner;
        }
        connect(from,next,now);from=next;
      }
    } else add(p,now);
    previous=p;wake();
  }
  host.addEventListener('pointerdown',event=>{
    if(event.target.closest('button') || !event.isPrimary) return;
    if(event.pointerType==='touch') {touchStart={x:event.clientX,y:event.clientY};return;}
    trace(event);
  },{passive:true});
  host.addEventListener('pointermove',trace,{passive:true});
  // Vertical touch scrolling is browser-owned; never preventDefault or capture it.
  host.addEventListener('pointerup',event=>{
    if(event.pointerType==='touch' && touchStart) {const p=local(event);pattern(p.x,p.y);}
    previous=null;touchStart=null;
  },{passive:true});
  for(const name of ['pointerleave','pointercancel']) host.addEventListener(name,()=>{previous=null;touchStart=null;},{passive:true});
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
