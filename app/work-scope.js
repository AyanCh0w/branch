/* What a piece of work will touch, and whether two pieces overlap. Shared by the canvas, the backend and tests. */
(function(root){
 function normalizePath(value){
  const path=String(value??'').trim().replace(/\\/g,'/').replace(/^(\.\/)+/,'').replace(/\/{2,}/g,'/').replace(/^\/+|\/+$/g,'');
  if(!path||path.length>200||/[\u0000-\u001f]/.test(path)||path.split('/').some(part=>part==='..'||part==='.'))return '';
  return path;
 }
 // A path already covered by a broader one in the same list adds nothing.
 function normalizePaths(list,max=40){
  const paths=[...new Set((Array.isArray(list)?list:[]).map(normalizePath).filter(Boolean))].sort();
  return paths.filter(path=>!paths.some(other=>other!==path&&covers(other,path))).slice(0,max);
 }
 function normalizeArea(value){
  const area=String(value??'').trim().toLowerCase().replace(/[\s_]+/g,'-').replace(/[^a-z0-9-]/g,'').replace(/-{2,}/g,'-').replace(/^-+|-+$/g,'');
  return area.length>40?'':area;
 }
 function normalizeAreas(list,max=8){return [...new Set((Array.isArray(list)?list:[]).map(normalizeArea).filter(Boolean))].slice(0,max);}
 // Prefixes match on whole path segments: app/ covers app/context.js but not apps/.
 function covers(parent,child){return parent===child||child.startsWith(parent+'/');}
 function overlap(a,b){
  const paths=new Set();
  for(const left of a?.paths||[])for(const right of b?.paths||[]){if(covers(left,right))paths.add(right);else if(covers(right,left))paths.add(left);}
  const areas=(a?.areas||[]).filter(area=>(b?.areas||[]).includes(area));
  return {paths:[...paths].sort(),areas,any:paths.size>0||areas.length>0};
 }
 const open=status=>status==='active'||status==='idle';
 // Other people's open work that touches the same scope. Items: {id,userId,status,paths,areas,...}.
 function overlapping(item,others){
  if(!open(item?.status))return [];
  return (others||[]).filter(other=>other&&other.id!==item.id&&other.userId!==item.userId&&open(other.status)).map(other=>({other,...overlap(item,other)})).filter(result=>result.any);
 }
 const api={normalizePath,normalizePaths,normalizeArea,normalizeAreas,covers,overlap,overlapping};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BranchWorkScope=api;
})(typeof globalThis!=='undefined'?globalThis:this);
