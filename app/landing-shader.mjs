// Visual reference: Unicorn Studio's public “Art Vortex” preview.
// Original procedural implementation: a soft graphite loop and connected points.
// No third-party runtime, remote assets, tracking, or API calls.
(() => {
  const host = document.getElementById('paper-background');
  if (!host) return;
  const toggle = document.getElementById('paper-background-on');
  const strength = document.getElementById('paper-background-strength');
  const output = document.getElementById('paper-background-value');
  const status = document.getElementById('paper-background-status');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const contrast = matchMedia('(prefers-contrast: more)');
  const mobile = matchMedia('(max-width: 600px)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const key = 'branch.paper-background.v1';
  let enabled = true, amount = 45;
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (typeof saved?.enabled === 'boolean') enabled = saved.enabled;
    if (Number.isFinite(saved?.amount)) amount = Math.max(0, Math.min(100, saved.amount));
  } catch {}
  const canvas = document.createElement('canvas');
  canvas.className = 'vortex-material';
  host.append(canvas);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('vortex-network');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  host.append(svg);
  const vertices = Array.from({length: 14}, (_, i) => ({angle: i * Math.PI * 2 / 14, x: 0, y: 0}));
  const edges = vertices.flatMap((_, i) => [3, 5].map(step => [i, (i + step) % vertices.length]));
  const paths = edges.map(() => {
    const path = document.createElementNS(ns, 'path');
    svg.append(path); return path;
  });
  const dots = vertices.map(() => {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('r', '2'); svg.append(dot); return dot;
  });
  let gl, program, buffer, uniforms;
  let width = 1, height = 1, radiusX = 1, radiusY = 1, centerY = 1;
  let frame = 0, last = 0, phase = 0, disposed = false, visible = true;
  const pointer = {x: 0, y: 0, tx: 0, ty: 0};
  const vertex = `attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}`;
  const fragment = `
    precision highp float;
    uniform vec2 resolution, center, radius, pointer;
    uniform float phase, dark;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){
      vec2 pixel=vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y);
      vec2 q=(pixel-center-pointer)/radius;
      float a=atan(q.y,q.x);
      // Asymmetric folds travel around the loop, rather than translating the page.
      float r=length(q);
      float ripple=.026*sin(a*3.+phase)+.012*sin(a*5.-phase*.7);
      float thickness=.095+.029*sin(a*3.+phase+.8);
      float crossSection=(r-(.86+ripple))/thickness;
      float edge=1.-smoothstep(.76,1.24,abs(crossSection));
      float normal=sqrt(max(0.,1.-crossSection*crossSection));
      float fold=sin(a*6.+crossSection*2.7+phase);
      float sheen=pow(max(0.,normal*.64+fold*.36),3.);
      float graphite=.19+.56*sheen+.15*sin(a*2.-phase*.25);
      float grain=(hash(gl_FragCoord.xy)-.5)*.055;
      float tone=mix(graphite,.45+.5*sheen,dark)+grain;
      // The soft skirt is the reference's defocused edge, without a CSS blur pass.
      float skirt=exp(-pow((r-.86-ripple)/(.14+thickness*.5),2.))* .09;
      float alpha=max(edge*.66,skirt);
      gl_FragColor=vec4(vec3(clamp(tone,0.,1.)),alpha);
    }`;
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {gl.deleteShader(shader); throw new Error('Shader compilation failed');}
    return shader;
  }
  function initialize() {
    try {
      gl = canvas.getContext('webgl', {alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power'});
      if (!gl) throw new Error('WebGL unavailable');
      const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
      program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader linking failed');
      gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      uniforms = Object.fromEntries(['resolution','center','radius','pointer','phase','dark'].map(name=>[name,gl.getUniformLocation(program,name)]));
      host.dataset.renderer = 'webgl';
    } catch {
      gl = null; host.dataset.renderer = 'fallback';
    }
  }
  function resize() {
    const rect = host.getBoundingClientRect(); width = rect.width; height = rect.height;
    radiusX = Math.min(width * .55, 670); radiusY = width < 600 ? 280 : 330;
    centerY = width < 600 ? 245 : 235;
    // Cap fill rate independently of device pixel ratio (including 3x phones).
    const scale = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(1400000/(width*height)));
    canvas.width = Math.max(1,Math.round(width*scale)); canvas.height = Math.max(1,Math.round(height*scale));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    host.style.setProperty('--vortex-x', `${radiusX*1.72}px`);
    host.style.setProperty('--vortex-y', `${radiusY*1.72}px`);
    host.style.setProperty('--vortex-center', `${centerY}px`);
    draw();
  }
  function draw() {
    if (disposed) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    if (gl && !gl.isContextLost()) {
      const scale = canvas.width / width;
      gl.viewport(0,0,canvas.width,canvas.height);
      gl.uniform2f(uniforms.resolution,canvas.width,canvas.height);
      gl.uniform2f(uniforms.center,width*.5*scale,centerY*scale);
      gl.uniform2f(uniforms.radius,radiusX*scale,radiusY*scale);
      gl.uniform2f(uniforms.pointer,pointer.x*scale,pointer.y*scale);
      gl.uniform1f(uniforms.phase,phase); gl.uniform1f(uniforms.dark,dark ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }
    vertices.forEach((p,i)=>{
      const a=p.angle+phase*.13, r=.82+.03*Math.sin(a*3+phase);
      p.x=width*.5+Math.cos(a)*radiusX*r+pointer.x;
      p.y=centerY+Math.sin(a)*radiusY*r+pointer.y;
      dots[i].setAttribute('cx',p.x.toFixed(2)); dots[i].setAttribute('cy',p.y.toFixed(2));
    });
    edges.forEach(([a,b],i)=>paths[i].setAttribute('d',`M${vertices[a].x.toFixed(2)},${vertices[a].y.toFixed(2)}L${vertices[b].x.toFixed(2)},${vertices[b].y.toFixed(2)}`));
  }
  function canAnimate() {return !disposed && enabled && amount>0 && visible && !document.hidden && !reduced.matches && !contrast.matches && host.dataset.renderer==='webgl';}
  function stop() {cancelAnimationFrame(frame); frame=0; last=0;}
  function tick(time) {
    frame=0;
    if (!canAnimate()) return;
    if (!last || time-last >= 1000/30-1) {
      const dt=last ? Math.min((time-last)/1000,.06) : 0;
      last=time; phase+=dt*.12;
      const ease=1-Math.exp(-dt*7);
      pointer.x+=(pointer.tx-pointer.x)*ease; pointer.y+=(pointer.ty-pointer.y)*ease;
      draw();
    }
    frame=requestAnimationFrame(tick);
  }
  function wake() {if (!frame && canAnimate()) frame=requestAnimationFrame(tick);}
  function save() {try {localStorage.setItem(key,JSON.stringify({enabled,amount}));} catch {}}
  // A viewport-sized mobile layer stays present beyond the hero without a tall GPU surface.
  function syncOpacity() {
    const progress = Math.max(0, Math.min(1, window.scrollY / Math.max(400, window.innerHeight * .8)));
    const eased = progress * progress * (3 - 2 * progress);
    const fade = mobile.matches ? 1 - .42 * eased : 1;
    host.style.opacity = enabled && !contrast.matches ? String(amount / 100 * fade) : '0';
  }
  function sync() {
    toggle.checked=enabled; strength.value=amount; strength.disabled=!enabled; output.value=`${amount}%`;
    syncOpacity();
    host.dataset.motion=reduced.matches ? 'static' : 'animated';
    status.textContent=reduced.matches ? 'Monochrome · Still vortex' : 'Monochrome · Connected vortex';
    stop(); draw(); wake();
  }
  initialize(); resize(); host.dataset.ready='true'; sync();
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting; if(visible) wake(); else stop();});
  observer.observe(host);
  const themeObserver=new MutationObserver(draw);
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  new ResizeObserver(resize).observe(host);
  window.addEventListener('scroll',syncOpacity,{passive:true});
  window.addEventListener('resize',syncOpacity,{passive:true});
  window.addEventListener('pageshow',syncOpacity);
  mobile.addEventListener('change',syncOpacity);
  window.addEventListener('pointermove',event=>{
    if (event.pointerType!=='mouse' || !fine.matches || reduced.matches) return;
    const rect=host.getBoundingClientRect();
    pointer.tx=Math.max(-1,Math.min(1,(event.clientX-width/2)/(width/2)))*12;
    pointer.ty=Math.max(-1,Math.min(1,(event.clientY-rect.top-centerY)/radiusY))*8;
  },{passive:true});
  function release() {pointer.tx=pointer.ty=0;}
  document.documentElement.addEventListener('pointerleave',release);
  window.addEventListener('blur',release);
  document.addEventListener('visibilitychange',()=>{if(document.hidden) stop(); else wake();});
  window.addEventListener('pagehide',stop);
  window.addEventListener('pageshow',wake);
  reduced.addEventListener('change',()=>{pointer.x=pointer.y=pointer.tx=pointer.ty=0;sync();});
  contrast.addEventListener('change',sync);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();stop();host.dataset.renderer='fallback';});
  canvas.addEventListener('webglcontextrestored',()=>{initialize();resize();sync();});
  toggle.addEventListener('change',()=>{enabled=toggle.checked;sync();save();});
  strength.addEventListener('input',()=>{amount=Number(strength.value);sync();});
  strength.addEventListener('change',save);
  document.getElementById('nav-appearance-reset')?.addEventListener('click',()=>{enabled=true;amount=45;sync();save();});
})();
