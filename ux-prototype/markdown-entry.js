import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
const escapeMath=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
// Tokenize before Markdown consumes backslashes, underscores, or matrix rows.
// Code fences and inline code keep Marked's normal literal handling.
marked.use({extensions:[{
 name:'displayMath',level:'block',
 start:src=>src.search(/(?:^|\n) {0,3}(?:\\\[|\$\$)/),
 tokenizer(src){const match=/^ {0,3}(?:\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$)(?:[ \t]*\n|$)/.exec(src);if(match)return{type:'displayMath',raw:match[0],text:match[1]??match[2]};},
 renderer:token=>`<div data-math="display" data-latex="${escapeMath(token.text)}"></div>\n`
},{
 name:'inlineMath',level:'inline',
 start:src=>src.search(/\\[([]|\$/),
 tokenizer(src){
  const match=/^(?:\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\$(?!\s)((?:\\[^\n]|[^$\n\\])*?[^\s$\\])\$(?!\d))/.exec(src);
  if(match)return{type:'inlineMath',raw:match[0],text:match[1]??match[2]??match[3]??match[4],display:match[2]!==undefined||match[3]!==undefined};
 },
 renderer:token=>`<span data-math="${token.display?'display':'inline'}" data-latex="${escapeMath(token.text)}"></span>`
}]});
// Treat model output as untrusted. GFM supplies tables, task lists and fences.
window.BranchMarkdown = text => {
 const html=marked.parse(String(text||''),{gfm:true,breaks:true,async:false});
 const clean=DOMPurify.sanitize(html,{USE_PROFILES:{html:true},FORBID_TAGS:['img','style','form','button','iframe','video','audio'],FORBID_ATTR:['style','id','name']});
 const template=document.createElement('template');template.innerHTML=clean;
 for(const input of template.content.querySelectorAll('input')){const check=document.createElement('span');check.className='markdown-task';check.textContent=input.checked?'☑ ':'☐ ';check.setAttribute('aria-label',input.checked?'Complete':'Incomplete');input.replaceWith(check);}
 for(const link of template.content.querySelectorAll('a')){
  const href=link.getAttribute('href')||'';
  if(!/^(https?:|mailto:)/i.test(href)){link.removeAttribute('href');continue;}
  link.target='_blank';link.rel='noopener noreferrer';
  if(/^https?:/i.test(href)){
   link.dataset.nodeLink='';
   link.dataset.tooltip='Open preview beside this node';
   link.removeAttribute('title');
  }
 }
 for(const table of template.content.querySelectorAll('table')){const wrap=document.createElement('div');wrap.className='markdown-table';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Scrollable table');table.replaceWith(wrap);wrap.append(table);}
 // Only trusted KaTeX output is inserted after sanitization; HTML extensions are disabled.
 for(const math of template.content.querySelectorAll('[data-math][data-latex]')){
  const latex=math.getAttribute('data-latex');
  try{math.innerHTML=katex.renderToString(latex,{displayMode:math.dataset.math==='display',trust:false,throwOnError:true,strict:'ignore',maxSize:20,maxExpand:1000});}
  catch{math.textContent=latex;} // Incomplete streamed expressions stay readable.
  math.removeAttribute('data-latex');
 }
 return template.innerHTML;
};
