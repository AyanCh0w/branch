/* Local PDF.js renderer; no browser/Google viewer and no third-party file uploads. */
const viewState = new Map();
class BranchPDF extends HTMLElement {
 connectedCallback(){
  const key=this.getAttribute('data-key')||this.getAttribute('src');
  this.state=viewState.get(key)||{page:1,zoom:1};viewState.set(key,this.state);
  this.attachShadow({mode:'open'}).innerHTML=`<style>
  :host{display:block;color:var(--theme-ink, #34363a);font:12px 'BDO Grotesk',sans-serif;background:var(--theme-raised, #f3f4f5);border-radius:12px;overflow:hidden}
  *{box-sizing:border-box}button,input,a{font:inherit;color:inherit}button,a{border:0;background:transparent;display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:30px;border-radius:7px;text-decoration:none;cursor:pointer}button:hover,a:hover{background:var(--theme-raised, #eceef0)}button:active{background:var(--theme-raised, #e0e3e6)}button:disabled{opacity:.3;cursor:default}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--theme-accent, #4083ed);outline-offset:1px}
  .toolbar{display:flex;align-items:center;gap:3px;padding:8px;background:var(--theme-surface, white);border-bottom:1px solid var(--theme-line, #e8e9eb);flex-wrap:wrap}input{width:38px;border:1px solid var(--theme-line, #e8e9eb);border-radius:5px;text-align:center;height:26px;background:var(--theme-surface, white)}input::-webkit-inner-spin-button{display:none}.spacer{flex:1}.count{color:var(--theme-muted, #84888d);margin-right:6px}.stage{height:400px;overflow:auto;padding:18px;overscroll-behavior:contain;position:relative}.paper{margin:auto;width:max-content;box-shadow:0 2px 8px var(--theme-shadow, #20283012);background:white;color:#171717;color-scheme:light}canvas{display:block}.status{padding:24px;line-height:1.6;text-align:center;color:var(--theme-muted, #70757c)}.status:empty{display:none}details{background:var(--theme-surface, white);padding:10px 14px;border-top:1px solid var(--theme-line, #e8e9eb)}summary{cursor:pointer;color:var(--theme-muted, #70757c)}.text{white-space:pre-wrap;line-height:1.6;max-height:220px;overflow:auto;user-select:text}.icon{width:16px;height:16px;filter:var(--theme-icon-filter,none)}.previous{transform:rotate(90deg)}.next{transform:rotate(-90deg)}:host(:fullscreen){border-radius:0;display:flex;flex-direction:column;background:var(--theme-raised, #f3f4f5)}:host(:fullscreen) .stage{height:auto;flex:1}.tip{position:fixed;background:color-mix(in srgb, var(--theme-surface, #ffffff) 94.12%, transparent);border:1px solid var(--theme-line, #e0e3e6);box-shadow:0 2px 6px var(--theme-shadow, #0001);padding:5px 8px;border-radius:6px;pointer-events:none;z-index:10;backdrop-filter:blur(12px)}
  </style><div class="toolbar" role="toolbar" aria-label="PDF controls">
  <button data-action="previous" aria-label="Previous page"><img class="icon previous" src="icons/nav-arrow-down.svg" alt=""></button><input aria-label="Page number" type="number" min="1" value="${this.state.page}"><span class="count">/ —</span><button data-action="next" aria-label="Next page"><img class="icon next" src="icons/nav-arrow-down.svg" alt=""></button><span class="spacer"></span>
  <button data-action="out" aria-label="Zoom out"><img class="icon" src="icons/minus.svg" alt=""></button><button data-action="fit" aria-label="Fit page to width">Fit</button><button data-action="in" aria-label="Zoom in"><img class="icon" src="icons/plus.svg" alt=""></button><button data-action="full" aria-label="Full screen"><img class="icon" src="icons/expand.svg" alt=""></button><a aria-label="Download PDF" download><img class="icon" src="icons/attachment.svg" alt=""></a></div>
  <div class="stage" tabindex="0" aria-label="PDF page"><div class="status" role="status">Loading document…</div><div class="paper"><canvas role="img" aria-label="PDF page"></canvas></div></div><details><summary>Page text</summary><div class="text"></div></details><span class="tip" hidden></span>`;
  const root=this.shadowRoot;root.querySelector('a').href=this.getAttribute('src');
  root.addEventListener('click',e=>{const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;
   if(action==='full'){if(document.fullscreenElement)document.exitFullscreen();else this.requestFullscreen().catch(()=>{});return;}
   if(!this.pdf)return;
   if(action==='previous')this.state.page=Math.max(1,this.state.page-1);
   if(action==='next')this.state.page=Math.min(this.pdf.numPages,this.state.page+1);
   if(action==='in')this.state.zoom=Math.min(2.5,this.state.zoom+.25);
   if(action==='out')this.state.zoom=Math.max(.5,this.state.zoom-.25);
   if(action==='fit')this.state.zoom=1;
   this.draw();
  });
  root.querySelector('input').addEventListener('change',e=>{if(this.pdf){this.state.page=Math.max(1,Math.min(this.pdf.numPages,Math.round(Number(e.target.value)||1)));this.draw();}});
  root.querySelector('.stage').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();root.querySelector(`[data-action="${e.key==='ArrowLeft'?'previous':'next'}"]`).click();}});
  const tip=root.querySelector('.tip');const show=e=>{const b=e.target.closest('button,a');if(!b)return;tip.textContent=b.getAttribute('aria-label');const r=b.getBoundingClientRect();tip.style.left=r.left+'px';tip.style.top=r.bottom+5+'px';tip.hidden=false;};root.addEventListener('pointerover',show);root.addEventListener('focusin',show);root.addEventListener('pointerout',()=>tip.hidden=true);root.addEventListener('focusout',()=>tip.hidden=true);
  this.resize=new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(width!==this.lastWidth){this.lastWidth=width;if(this.pdf)this.draw();}});this.resize.observe(this);
  this.load();
 }
 async load(){try{const lib=await import('./pdfjs/pdf.mjs');if(!this.isConnected)return;lib.GlobalWorkerOptions.workerSrc='./pdfjs/pdf.worker.mjs';this.task=lib.getDocument({url:this.getAttribute('src'),cMapUrl:'./pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'./pdfjs/standard_fonts/',wasmUrl:'./pdfjs/wasm/',isEvalSupported:false});this.pdf=await this.task.promise;if(!this.isConnected)return;this.state.page=Math.min(this.state.page,this.pdf.numPages);await this.draw();}catch(error){if(this.isConnected){this.shadowRoot.querySelector('.status').textContent=error.name==='PasswordException'?'This PDF is password protected. Upload an unlocked copy to preview it.':'Could not preview this PDF. Download it to check the file, or upload it again.';}}}
 async draw(){
  const version=this.version=(this.version||0)+1;this.renderTask?.cancel();
  const root=this.shadowRoot;root.querySelector('input').value=this.state.page;root.querySelector('input').max=this.pdf.numPages;root.querySelector('.count').textContent='/ '+this.pdf.numPages;root.querySelector('[data-action=previous]').disabled=this.state.page<=1;root.querySelector('[data-action=next]').disabled=this.state.page>=this.pdf.numPages;root.querySelector('[data-action=fit]').textContent=this.state.zoom===1?'Fit':Math.round(this.state.zoom*100)+'%';
  try{const page=await this.pdf.getPage(this.state.page);if(version!==this.version||!this.isConnected)return;
   const base=page.getViewport({scale:1}),scale=Math.max(80,this.clientWidth-36)/base.width*this.state.zoom,viewport=page.getViewport({scale}),canvas=root.querySelector('canvas'),dpr=Math.min(devicePixelRatio||1,2);
   canvas.width=Math.floor(viewport.width*dpr);canvas.height=Math.floor(viewport.height*dpr);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';canvas.setAttribute('aria-label',`Page ${this.state.page} of ${this.pdf.numPages}`);
   this.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[dpr,0,0,dpr,0,0]});await this.renderTask.promise;if(version!==this.version)return;root.querySelector('.status').textContent='';
   const text=await page.getTextContent();if(version!==this.version)return;root.querySelector('.text').textContent=text.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('')||'This page contains no selectable text. The complete PDF is still included in chat context.';
  }catch(error){if(error.name!=='RenderingCancelledException'&&version===this.version)root.querySelector('.status').textContent='This page could not be rendered.';}
 }
 disconnectedCallback(){this.version=(this.version||0)+1;this.resize?.disconnect();this.renderTask?.cancel();this.task?.destroy();}
}
customElements.define('branch-pdf',BranchPDF);
