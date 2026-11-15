// Native document scrolling, with a staged canvas entrance inspired by Unicorn.
// Input, scroll restoration, keyboard navigation and anchors remain browser-owned.
(() => {
  const root=document.documentElement;
  const hero=document.querySelector('.hero-copy');
  const demo=document.querySelector('.flow-demo');
  if (!hero || !demo || !('IntersectionObserver' in window)) return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const desktop=matchMedia('(min-width: 801px)');
  const track=document.createElement('div');track.className='demo-scroll-track';
  const stage=document.createElement('div');stage.className='demo-scroll-stage';
  demo.before(track);track.append(stage);stage.append(demo);
  const arrivals=[...document.querySelectorAll('.comparison .section-heading,.comparison-grid,.branching .section-heading,.branch-demo,.feature-list .section-heading,.feature-grid article,.closing>div,.faq>div')];
  let enabled=false,frame=0,start=0,travel=1;
  const clamp=value=>Math.max(0,Math.min(1,value));
  const ease=value=>value*value*(3-2*value);
  function reveal(element) {element.classList.add('is-arrived');}
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(entry.isIntersecting){reveal(entry.target);observer.unobserve(entry.target);}
  }),{threshold:.08,rootMargin:'0px 0px -32px 0px'});
  function render() {
    frame=0;if(!enabled)return;
    const progress=ease(clamp(window.scrollY/travel));
    stage.style.setProperty('--demo-scale',String(.96+.04*progress));
    const departure=ease(clamp(window.scrollY/Math.max(260,start)));
    hero.style.setProperty('--hero-drift',`${departure*22}px`);
    hero.style.setProperty('--hero-opacity',String(1-departure*.2));
  }
  function requestRender(){if(enabled&&!frame)frame=requestAnimationFrame(render);}
  function measure(){
    if(!enabled)return;
    cancelAnimationFrame(frame);frame=0;
    // Measure untransformed layout; animation never feeds back into its own geometry.
    start=track.getBoundingClientRect().top+window.scrollY;
    travel=Math.max(160,start-96);
    const fits=stage.offsetHeight<=window.innerHeight-120;
    track.classList.toggle('can-pin',fits);
    track.style.setProperty('--demo-height', `${stage.offsetHeight}px`);
    track.style.setProperty('--demo-hold',fits?`${Math.min(220,window.innerHeight*.24)}px`:'0px');
    render();
  }
  function sync(){
    enabled=desktop.matches&&!reduced.matches;
    root.dataset.scrollDesign=enabled?'enhanced':'static';
    cancelAnimationFrame(frame);frame=0;observer.disconnect();
    track.classList.remove('can-pin');track.style.removeProperty('--demo-hold');track.style.removeProperty('--demo-height');
    stage.style.removeProperty('--demo-scale');
    hero.style.removeProperty('--hero-drift');hero.style.removeProperty('--hero-opacity');
    arrivals.forEach((element,index)=>{
      element.classList.remove('scroll-arrival');
      if(enabled){
        element.style.setProperty('--arrival-delay',`${element.matches('.feature-grid article')?(index%3)*55:0}ms`);
        if(element.getBoundingClientRect().top<innerHeight-32)reveal(element);
        element.classList.add('scroll-arrival');
        observer.observe(element);
      }
    });
    measure();
  }
  document.addEventListener('focusin',event=>{
    const arrival=event.target.closest('.scroll-arrival');
    if(arrival)reveal(arrival);
  });
  window.addEventListener('scroll',requestRender,{passive:true});
  window.addEventListener('resize',measure,{passive:true});
  window.addEventListener('pageshow',measure);
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);frame=0;});
  reduced.addEventListener('change',sync);desktop.addEventListener('change',sync);
  new ResizeObserver(measure).observe(demo);
  document.fonts?.ready.then(measure);
  sync();
})();
