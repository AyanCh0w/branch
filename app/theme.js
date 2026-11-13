/* Run before styles paint. Appearance is device-local, never shared board state. */
(()=>{
 const key='branch-appearance',root=document.documentElement,system=window.matchMedia('(prefers-color-scheme: dark)');
 const valid=value=>['light','dark','system'].includes(value)?value:'system';
 let preference='system';
 try{preference=valid(localStorage.getItem(key));}catch{}
 function apply(){
  const dark=preference==='dark'||(preference==='system'&&system.matches);
  root.dataset.theme=dark?'dark':'light';root.style.colorScheme=dark?'dark':'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#17191d':'#ffffff');
  document.querySelectorAll('[data-appearance]').forEach(el=>{el.value=preference;});
  window.dispatchEvent(new Event('branch-appearance'));
 }
 window.BranchTheme={get:()=>preference,set(value){preference=valid(value);try{localStorage.setItem(key,preference);}catch{}apply();}};
 system.addEventListener('change',()=>{if(preference==='system')apply();});
 window.addEventListener('storage',event=>{if(event.key===key||event.key===null){preference=valid(event.newValue);apply();}});
 document.addEventListener('change',event=>{if(event.target.matches('[data-appearance]'))window.BranchTheme.set(event.target.value);});
 document.addEventListener('DOMContentLoaded',apply);
 apply();
})();
