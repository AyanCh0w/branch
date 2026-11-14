'use strict';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=(text,n)=>String(text||'').replace(/\s+/g,' ').slice(0,n);
const finite=(value,fallback)=>Number.isFinite(Number(value))?Math.max(-1e6,Math.min(1e6,Number(value))):fallback;
function boardSVG(board){
 const nodes=(board.nodes||[]).slice(0,100).map(n=>({...n,x:finite(n.x,0),y:finite(n.y,0),w:Math.max(180,Math.min(900,finite(n.width,380))),h:Math.max(120,Math.min(700,finite(n.height,240)))}));
 const left=(nodes.length?Math.min(...nodes.map(n=>n.x)):0),top=(nodes.length?Math.min(...nodes.map(n=>n.y)):0);
 const right=Math.max(...nodes.map(n=>n.x+n.w),left+1),bottom=Math.max(...nodes.map(n=>n.y+n.h),top+1);
 const scale=Math.min(1.3,1080/(right-left),422/(bottom-top));
 const dx=(1200-(right-left)*scale)/2-left*scale,dy=150+(422-(bottom-top)*scale)/2-top*scale;
 const text=(x,y,size,value,fill='#27292d')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}">${escape(value)}</text>`;
 const wires=nodes.flatMap(n=>(n.connections||[]).map(key=>{const from=nodes.find(s=>s.key===key);if(!from)return '';const x=from.x+from.w,y=from.y+from.h/2,tx=n.x,ty=n.y+n.h/2;return `<path d="M${x} ${y} C${x+90} ${y} ${tx-90} ${ty} ${tx} ${ty}" fill="none" stroke="#638ee6" stroke-width="3" stroke-dasharray="5 6" stroke-linecap="round"/>`;})).join('');
 const cards=nodes.map(n=>{
  const lines=short(n.body,260).match(/.{1,48}(?:\s|$)|.{1,48}/g)||[];
  return `<rect x="${n.x}" y="${n.y+4}" width="${n.w}" height="${n.h}" rx="16" fill="#e4e6ea"/><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="16" fill="white" stroke="#d9dce1"/>${text(n.x+20,n.y+32,17,short(n.title,Math.floor(n.w/10)))}${lines.slice(0,Math.floor((n.h-70)/24)).map((line,i)=>text(n.x+20,n.y+70+i*24,13,short(line,Math.floor((n.w-40)/7)),'#777b83')).join('')}<circle cx="${n.x+n.w}" cy="${n.y+n.h/2}" r="6" fill="#638ee6"/>`;
 }).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" font-family="Liberation Sans"><defs><pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r=".7" fill="#d8dce1"/></pattern></defs><rect width="1200" height="630" fill="#f8f9fa"/><rect y="120" width="1200" height="510" fill="url(#dots)"/><rect width="1200" height="120" fill="white"/>${text(48,57,30,short(board.title,64))}${text(48,91,16,`${board.count||0} ${(board.count||0)===1?'card':'cards'} · Shared board`,'#737780')}${text(1050,69,25,'branch')}<g transform="translate(${dx} ${dy}) scale(${scale})">${wires}${cards}</g>${!nodes.length?text(460,350,24,'Room for your next idea.','#898d95'):''}</svg>`;
}
function metadataHTML(html,board,url){
 const title=board?board.title:'Branch / workspace',description=board?`${board.count} ${board.count===1?'card':'cards'} · Open this shared board on Branch.`:'A shared space for ideas on Branch.';
 const tags=[['og:type','website'],['og:site_name','Branch'],['og:title',title],['og:description',description],['og:url',url.href],['twitter:card',board?'summary_large_image':'summary'],['twitter:title',title],['twitter:description',description]];
 if(board){const image=new URL('/api/share-image',url);image.searchParams.set('join',url.searchParams.get('join'));tags.push(['og:image',image.href],['og:image:type','image/png'],['og:image:width','1200'],['og:image:height','630'],['og:image:alt',`Board preview: ${title}`],['twitter:image',image.href]);}
 return html.replace(/<title>.*?<\/title>/s,`<title>${escape(title)}</title>`).replace('</head>',`<meta name="referrer" content="no-referrer"><meta name="description" content="${escape(description)}">${tags.map(([key,value])=>`<meta ${key.startsWith('twitter:')?'name':'property'}="${key}" content="${escape(value)}">`).join('')}</head>`);
}
module.exports={boardSVG,metadataHTML};
