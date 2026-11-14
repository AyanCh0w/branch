// Sparse canvas connectors, using the same horizontal Bezier routing and
// rounded dashes/ports as the chat connections. SVG needs no WebGL.
(() => {
const host = document.getElementById('paper-background');
const toggle = document.getElementById('paper-background-on');
const strength = document.getElementById('paper-background-strength');
const output = document.getElementById('paper-background-value');
const contrast = matchMedia('(prefers-contrast: more)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const key = 'branch.paper-background.v1';
let enabled = true, amount = 45;
try {
  const saved = JSON.parse(localStorage.getItem(key));
  if (typeof saved?.enabled === 'boolean') enabled = saved.enabled;
  if (Number.isFinite(saved?.amount)) amount = Math.max(0, Math.min(100, saved.amount));
} catch {}
const edges = [
  [[-24,125],[150,255]], [[150,255],[300,185]],
  [[150,255],[260,430]],
  [[1464,145],[1290,285]], [[1290,285],[1165,405]],
  [[-30,775],[165,660]], [[165,660],[285,825]],
  [[1470,800],[1295,670]], [[1295,670],[1160,825]],
  [[-35,460],[105,530]], [[105,530],[260,430]],
  [[1465,465],[1340,525]], [[1340,525],[1295,670]],
  [[165,660],[105,530]],
  [[-20,960],[150,890]], [[150,890],[285,825]],
  [[1455,980],[1315,910]], [[1315,910],[1160,825]],
];
// Shared junctions have one position so connected paths never separate.
const points = new Map();
function point(x,y) {
  const key = `${x},${y}`;
  if (!points.has(key)) points.set(key,{x,y,dx:0,dy:0,vx:0,vy:0});
  return points.get(key);
}
const wires = edges.map(([a,b])=>{
  const bend = Math.max(48, Math.abs(b[0]-a[0]) * .48);
  const dir = Math.sign(b[0]-a[0]);
  return {a:point(...a),b:point(...b),
    c: {x:a[0]+bend*dir,y:a[1],dx:0,dy:0,vx:0,vy:0},
    d: {x:b[0]-bend*dir,y:b[1],dx:0,dy:0,vx:0,vy:0}};
});
const position = p => `${(p.x+p.dx).toFixed(2)} ${(p.y+p.dy).toFixed(2)}`;
const curve = w => `M${position(w.a)} C${position(w.c)},${position(w.d)},${position(w.b)}`;
host.innerHTML = `<svg viewBox="0 0 1440 1000" preserveAspectRatio="none" focusable="false" aria-hidden="true">
  <g class="canvas-connection-lines">${wires.map(w=>`<path d="${curve(w)}"/>`).join('')}</g>
  <g class="canvas-connection-ports">${[...points.values()].map(p=>`<rect x="${p.x-5}" y="${p.y-2}" width="10" height="4" rx="2"/>`).join('')}</g>
</svg>`;
const paths = [...host.querySelectorAll('path')];
const ports = [...host.querySelectorAll('rect')];
const joints = [...points.values()];
const particles = [...joints, ...wires.flatMap(w=>[w.c,w.d])];
let pointer = null, frame = 0, previousTime = 0;
let width = innerWidth, height = innerHeight;
function canMove() {
  return enabled && amount > 0 && !contrast.matches && !reducedMotion.matches && finePointer.matches && !document.hidden;
}
function render() {
  wires.forEach((w,i)=>paths[i].setAttribute('d',curve(w)));
  joints.forEach((p,i)=>ports[i].setAttribute('transform',`translate(${p.dx.toFixed(2)} ${p.dy.toFixed(2)})`));
}
function reset() {
  cancelAnimationFrame(frame); frame = 0; previousTime = 0; pointer = null;
  particles.forEach(p=>{p.dx=p.dy=p.vx=p.vy=0;});
  render();
}
function tick(time) {
  frame = 0;
  if (!canMove()) {reset();return;}
  const dt = Math.min((time-previousTime)/1000 || 1/60,1/30);
  previousTime = time;
  let moving = false;
  particles.forEach(p=>{
    let tx=0,ty=0;
    if (pointer) {
      const x=p.x*width/1440,y=p.y*height/1000;
      const distance=Math.hypot(pointer.x-x,pointer.y-y);
      const influence=Math.pow(Math.max(0,1-distance/260),2);
      // Bounded local attraction: no whole-page parallax or moving text.
      tx=Math.tanh((pointer.x-x)/85)*14*influence*1440/width;
      ty=Math.tanh((pointer.y-y)/85)*14*influence*1000/height;
    }
    p.vx+=(150*(tx-p.dx)-25*p.vx)*dt;
    p.vy+=(150*(ty-p.dy)-25*p.vy)*dt;
    p.dx+=p.vx*dt;p.dy+=p.vy*dt;
    if (Math.abs(tx-p.dx)+Math.abs(ty-p.dy)+Math.abs(p.vx)+Math.abs(p.vy)>.035) moving=true;
    else {p.dx=tx;p.dy=ty;p.vx=p.vy=0;}
  });
  render();
  if (moving) frame=requestAnimationFrame(tick);
  else previousTime=0;
}
function wake() {if (!frame && canMove()) frame=requestAnimationFrame(tick);}
function release() {pointer=null;wake();}
window.addEventListener('pointermove',event=>{
  if (event.pointerType !== 'mouse' || !canMove()) return;
  pointer={x:event.clientX,y:event.clientY};wake();
},{passive:true});
document.documentElement.addEventListener('pointerleave',release);
window.addEventListener('blur',release);
window.addEventListener('resize',()=>{width=innerWidth;height=innerHeight;release();},{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden) reset();});
window.addEventListener('pagehide',reset);
reducedMotion.addEventListener('change',reset);
finePointer.addEventListener('change',reset);
host.dataset.ready = 'true';
function save() {try {localStorage.setItem(key,JSON.stringify({enabled,amount}));} catch {}}
function sync() {
  toggle.checked = enabled; strength.value = amount; strength.disabled = !enabled;
  output.value = `${amount}%`;
  // Even maximum intensity stays quiet behind the product itself.
  host.style.opacity = enabled && !contrast.matches ? String(amount * .0028) : '0';
  if (!canMove()) reset();
}
toggle.addEventListener('change',()=>{enabled=toggle.checked;sync();save();});
strength.addEventListener('input',()=>{amount=Number(strength.value);sync();});
strength.addEventListener('change',save);
contrast.addEventListener('change',sync);
window.addEventListener('pageshow',sync);
sync();
})();
