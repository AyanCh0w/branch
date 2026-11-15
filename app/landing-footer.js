// A local, decorative connection canvas. No tracking or network requests.
(() => {
  const host = document.getElementById('footer-playground');
  if (!host) return;
  const canvas = host.querySelector('canvas');
  const button = host.querySelector('button');
  const ctx = canvas.getContext('2d');
  if (!ctx) { button.hidden = true; return; }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const step = 32, hold = 500, removalInterval = 50, transition = 140;
  const footer = host.closest('.site-footer');
  const darknessInput = document.getElementById('footer-darkness');
  const darknessOutput = document.getElementById('footer-darkness-value');
  const darknessKey = 'branch.footer-darkness.v1';
  let darkness = 85;
  try {
    const saved = localStorage.getItem(darknessKey);
    if (saved !== null && Number.isFinite(Number(saved))) darkness = Math.max(0,Math.min(100,Number(saved)));
    else if (localStorage.getItem('branch-footer-tone') === 'light') darkness = 0;
  } catch {}
  function setDarkness(value) {
    darkness = value;
    const rgb = [237,240,243].map((c,i)=>Math.round(c+([20,24,30][i]-c)*value/100));
    const luminance = rgb.map(c=>{c/=255;return c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);})
      .reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
    const dark = luminance < .179;
    const ink = dark ? [240,242,245] : [32,38,46];
    const color = values => `rgb(${values.join(',')})`;
    const shifted = amount => rgb.map(c=>Math.max(0,Math.min(255,c+amount)));
    footer.dataset.footerTone = dark ? 'dark' : 'light';
    footer.style.setProperty('--footer-bg',color(rgb));
    footer.style.setProperty('--footer-ink',color(ink));
    footer.style.setProperty('--footer-muted',color(ink));
    footer.style.setProperty('--footer-border',color(shifted(dark ? 23 : -21)));
    footer.style.setProperty('--footer-dot',color(shifted(dark ? 40 : -50)));
    footer.style.setProperty('--footer-control',color(shifted(dark ? 7 : 9)));
    footer.style.setProperty('--footer-hover',dark ? '#fff' : '#16263e');
    if (darknessInput) darknessInput.value = String(value);
    if (darknessOutput) darknessOutput.value = `${value}%`;
  }
  function saveDarkness() { try { localStorage.setItem(darknessKey,String(darkness)); } catch {} }
  setDarkness(darkness);
  darknessInput?.addEventListener('input',()=>{
    setDarkness(Number(darknessInput.value));
    if (nodes.size) wake();
  });
  darknessInput?.addEventListener('change',saveDarkness);
  document.getElementById('nav-appearance-reset')?.addEventListener('click',()=>{
    setDarkness(85);saveDarkness();if (nodes.size) wake();
  });
  let lastRemoval = 0;
  let width = 1, height = 1, frame = 0, visible = true, previous = null, touchStart = null;
  let nodes = new Map(), edges = [];
  // Background dots sit at 16 + 32n; active points occupy the gaps between them.
  const snap = n => Math.round(n / step) * step;
  const key = p => `${p.x}:${p.y}`;
  const point = (x, y) => ({x: snap(x), y: snap(y)});
  function stop() { cancelAnimationFrame(frame); frame = 0; }
  function clear() { stop(); nodes.clear(); edges = []; previous = null; touchStart = null; host.dataset.engaged='false'; lastRemoval = 0; ctx.clearRect(0,0,width,height); }
  function add(p, time) {
    // Keep the full 20px block and its curved connector inside the clipped canvas.
    const inset = 16;
    if (p.x < inset || p.y < inset || p.x > width - inset || p.y > height - 68) return false;
    const existing = nodes.get(key(p));
    nodes.delete(key(p)); nodes.set(key(p), {...p, time, born: existing?.born ?? time});
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
    // Retract in order, but let each point settle and shrink instead of popping.
    if (!reduced.matches) {
      for (const [id,p] of nodes) {
        if (p.retire === undefined) {
          const due = Math.max(p.time + hold, lastRemoval + removalInterval);
          if (time < due) break;
          p.retire = due; lastRemoval = due;
        }
        if (time >= p.retire + transition) nodes.delete(id);
      }
    }
    const ease = t => 1 - Math.pow(1 - Math.max(0, Math.min(1,t)),3);
    const scale = p => reduced.matches ? 1 : ease((time-p.born)/transition) *
      (p.retire === undefined ? 1 : 1-ease((time-p.retire)/transition));
    edges = edges.filter(edge=>nodes.has(key(edge.a)) && nodes.has(key(edge.b)));
    for (let i=0;i<edges.length;i++) {
      const edge=edges[i];
      const strength = Math.min(scale(nodes.get(key(edge.a))),scale(nodes.get(key(edge.b))));
      ctx.strokeStyle=`rgba(${color},${.58*strength})`; ctx.lineWidth=1.5; ctx.lineCap='round';
      // Shared tangents carry the curve through points without rigid elbows.
      const before=edges[i-1],after=edges[i+1];
      const start=before && key(before.b)===key(edge.a) ? before.a : edge.a;
      const end=after && key(after.a)===key(edge.b) ? after.b : edge.b;
      // A small, stable bow softens straight runs without making the trail wobble.
      const dx=edge.b.x-edge.a.x,dy=edge.b.y-edge.a.y;
      const length=Math.hypot(dx,dy)||1;
      const bend=3*Math.sin((edge.a.x+edge.b.x)*.008+(edge.a.y+edge.b.y)*.011+.8);
      const bowX=-dy/length*bend,bowY=dx/length*bend;
      ctx.beginPath();ctx.moveTo(edge.a.x,edge.a.y);
      ctx.bezierCurveTo(
        edge.a.x+(edge.b.x-start.x)/6+bowX,edge.a.y+(edge.b.y-start.y)/6+bowY,
        edge.b.x-(end.x-edge.a.x)/6+bowX,edge.b.y-(end.y-edge.a.y)/6+bowY,
        edge.b.x,edge.b.y);ctx.stroke();
    }
    for (const p of nodes.values()) {
      const size=scale(p);
      ctx.fillStyle=`rgba(${color},${.95*size})`;
      ctx.beginPath();ctx.roundRect(p.x-10*size,p.y-10*size,20*size,20*size,4*size);ctx.fill();
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
      connect(center,tip,now);
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
