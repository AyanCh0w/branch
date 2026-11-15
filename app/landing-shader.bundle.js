(()=>{(()=>{let a=document.getElementById("paper-background");if(!a)return;let k=matchMedia("(prefers-reduced-motion: reduce)"),q=matchMedia("(prefers-contrast: more)"),O=matchMedia("(max-width: 600px)"),V=matchMedia("(hover: hover) and (pointer: fine)"),Y={mobile:22,desktop:45},$=()=>O.matches?"mobile":"desktop",i=document.createElement("canvas");i.className="vortex-material",a.append(i);let _="http://www.w3.org/2000/svg",d=document.createElementNS(_,"svg");d.classList.add("vortex-network"),d.setAttribute("aria-hidden","true"),d.setAttribute("focusable","false"),a.append(d);let l=Array.from({length:14},(t,r)=>({angle:r*Math.PI*2/14,x:0,y:0})),I=l.flatMap((t,r)=>[3,5].map(n=>[r,(r+n)%l.length])),j=I.map(()=>{let t=document.createElementNS(_,"path");return d.append(t),t}),N=l.map(()=>{let t=document.createElementNS(_,"circle");return t.setAttribute("r","2"),d.append(t),t}),e,h,z,u,c=1,m=1,L=1,x=1,w=1,v=0,g=0,F=0,D=!1,C=!0,f=[1,0,0],y=[700,2200],o={x:0,y:0,tx:0,ty:0},K="attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}",J=`
    precision highp float;
    uniform vec2 resolution, center, radius, pointer;
    uniform float phase, dark;
    uniform vec3 scenes;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    vec4 material(vec2 q){
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
      return vec4(vec3(clamp(tone,0.,1.)),alpha);
    }
    void main(){
      vec2 pixel=vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y);
      vec2 uv=pixel/resolution;
      vec4 hero=material((pixel-center-pointer)/radius);
      // Wide side loops keep the shared-work section open and quiet in the center.
      vec4 left=material((uv-vec2(-.15,.52)-pointer/resolution)/vec2(.46,.9));
      vec4 right=material((uv-vec2(1.14,.55)+pointer/resolution)/vec2(.43,.92));
      vec4 sides=mix(left,right,smoothstep(.35,.65,uv.x));
      // A lower, broader arc closes the narrative without another busy focal point.
      vec4 quiet=material((uv-vec2(.72,1.12)-pointer/resolution*.4)/vec2(.95,.78));
      float readingMask=mix(.16,1.,smoothstep(.22,.48,abs(uv.x-.5)));
      sides.a*=readingMask;
      quiet.a*=readingMask*.8;
      vec4 result=hero*scenes.x+sides*scenes.y+quiet*scenes.z;
      gl_FragColor=result;
    }`;function U(t,r){let n=e.createShader(t);if(e.shaderSource(n,r),e.compileShader(n),!e.getShaderParameter(n,e.COMPILE_STATUS))throw e.deleteShader(n),new Error("Shader compilation failed");return n}function G(){try{if(e=i.getContext("webgl",{alpha:!0,antialias:!1,depth:!1,stencil:!1,premultipliedAlpha:!1,powerPreference:"low-power"}),!e)throw new Error("WebGL unavailable");let t=U(e.VERTEX_SHADER,K),r=U(e.FRAGMENT_SHADER,J);if(h=e.createProgram(),e.attachShader(h,t),e.attachShader(h,r),e.linkProgram(h),e.deleteShader(t),e.deleteShader(r),!e.getProgramParameter(h,e.LINK_STATUS))throw new Error("Shader linking failed");e.useProgram(h),z=e.createBuffer(),e.bindBuffer(e.ARRAY_BUFFER,z),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),e.STATIC_DRAW);let n=e.getAttribLocation(h,"position");e.enableVertexAttribArray(n),e.vertexAttribPointer(n,2,e.FLOAT,!1,0,0),u=Object.fromEntries(["resolution","center","radius","pointer","phase","dark","scenes"].map(s=>[s,e.getUniformLocation(h,s)])),a.dataset.renderer="webgl"}catch{e=null,a.dataset.renderer="fallback"}}function R(){let t=a.getBoundingClientRect();c=t.width,m=t.height,L=Math.min(c*.55,670),x=c<600?280:330,w=c<600?245:235;let r=Math.min(devicePixelRatio||1,1.5,Math.sqrt(14e5/(c*m)));i.width=Math.max(1,Math.round(c*r)),i.height=Math.max(1,Math.round(m*r)),d.setAttribute("viewBox",`0 0 ${c} ${m}`),a.style.setProperty("--vortex-x",`${L*1.72}px`),a.style.setProperty("--vortex-y",`${x*1.72}px`),a.style.setProperty("--vortex-center",`${w}px`);let n=(s,p)=>{let S=document.querySelector(s);return S?S.getBoundingClientRect().top+window.scrollY:p};y=[n("#together",700),n("#features",2200)],A(),b()}function b(){if(D)return;let t=document.documentElement.dataset.theme==="dark";if(e&&!e.isContextLost()){let r=i.width/c;e.viewport(0,0,i.width,i.height),e.uniform2f(u.resolution,i.width,i.height),e.uniform2f(u.center,c*.5*r,w*r),e.uniform2f(u.radius,L*r,x*r),e.uniform2f(u.pointer,o.x*r,o.y*r),e.uniform1f(u.phase,F),e.uniform1f(u.dark,t?1:0),e.uniform3f(u.scenes,...f),e.drawArrays(e.TRIANGLES,0,6)}d.style.opacity=String(.38*f[0]+.08*(1-f[0])),l.forEach((r,n)=>{let s=r.angle+F*.13,p=.82+.03*Math.sin(s*3+F);r.x=c*.5+Math.cos(s)*L*p+o.x,r.y=w+Math.sin(s)*x*p+o.y,N[n].setAttribute("cx",r.x.toFixed(2)),N[n].setAttribute("cy",r.y.toFixed(2))}),I.forEach(([r,n],s)=>j[s].setAttribute("d",`M${l[r].x.toFixed(2)},${l[r].y.toFixed(2)}L${l[n].x.toFixed(2)},${l[n].y.toFixed(2)}`))}function T(){return!D&&Y[$()]>0&&C&&!document.hidden&&!k.matches&&!q.matches&&a.dataset.renderer==="webgl"}function E(){cancelAnimationFrame(v),v=0,g=0}function H(t){if(v=0,!!T()){if(!g||t-g>=1e3/30-1){let r=g?Math.min((t-g)/1e3,.06):0;g=t,F+=r*.12;let n=1-Math.exp(-r*7);o.x+=(o.tx-o.x)*n,o.y+=(o.ty-o.y)*n,b()}v=requestAnimationFrame(H)}}function P(){!v&&T()&&(v=requestAnimationFrame(H))}function A(){let t=Math.max(0,Math.min(1,window.scrollY/Math.max(400,window.innerHeight*.8))),n=1-.42*(t*t*(3-2*t)),s=(X,Q)=>{let B=Math.max(0,Math.min(1,(window.scrollY-X)/(Q-X)));return B*B*(3-2*B)},p=s(y[0]-m*.8,y[0]-m*.15),S=s(y[1]-m*.65,y[1]+m*.15);f=[1-p,p*(1-S),p*S],a.dataset.scene=f[0]>.5?"hero":f[1]>.5?"shared-work":"quiet",a.style.opacity=q.matches?"0":String(Y[$()]/100*n),a.style.setProperty("--background-reading",String(1-f[0])),T()||b()}function M(){A(),a.dataset.motion=k.matches?"static":"animated",E(),b(),P()}G(),R(),a.dataset.ready="true",M(),new IntersectionObserver(([t])=>{C=t.isIntersecting,C?P():E()}).observe(a),new MutationObserver(b).observe(document.documentElement,{attributes:!0,attributeFilter:["data-theme"]}),new ResizeObserver(R).observe(a),document.fonts?.ready.then(R),window.addEventListener("scroll",A,{passive:!0}),window.addEventListener("resize",A,{passive:!0}),window.addEventListener("pageshow",A),O.addEventListener("change",M),window.addEventListener("pointermove",t=>{if(t.pointerType!=="mouse"||!V.matches||k.matches)return;let r=a.getBoundingClientRect();o.tx=Math.max(-1,Math.min(1,(t.clientX-c/2)/(c/2)))*12,o.ty=Math.max(-1,Math.min(1,(t.clientY-r.top-w)/x))*8},{passive:!0});function W(){o.tx=o.ty=0}document.documentElement.addEventListener("pointerleave",W),window.addEventListener("blur",W),document.addEventListener("visibilitychange",()=>{document.hidden?E():P()}),window.addEventListener("pagehide",E),window.addEventListener("pageshow",P),k.addEventListener("change",()=>{o.x=o.y=o.tx=o.ty=0,M()}),q.addEventListener("change",M),i.addEventListener("webglcontextlost",t=>{t.preventDefault(),E(),a.dataset.renderer="fallback"}),i.addEventListener("webglcontextrestored",()=>{G(),R(),M()})})();})();
