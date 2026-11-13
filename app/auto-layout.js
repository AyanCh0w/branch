/* Shared deterministic rectangle packing, also used by server-created cards. */
(function(root){
 function dimensions(n){return {width:n.width||(n.type==='thread'?520:n.type==='web'?440:380),height:Math.max(n.layoutHeight||0,n.minHeight||0,n.type==='thread'?640:n.type==='web'?(n.researchSource?160:380):260)};}
 function place(nodes,preferred,width=440,height=380){
  const gap=64;let x=preferred.x,y=preferred.y;
  // Advance past the entire obstructing rectangle; never give up after a fixed retry count.
  for(let i=0;i<=nodes.length;i++){
   const hits=nodes.filter(n=>{const d=dimensions(n);return x<n.x+d.width+gap&&x+width+gap>n.x&&y<n.y+d.height+gap&&y+height+gap>n.y;});
   if(!hits.length)return{x,y};
   y=Math.max(...hits.map(n=>n.y+dimensions(n).height+gap));
  }
  return{x,y};
 }
 const api={place,dimensions};if(typeof module==='object')module.exports=api;else root.BranchAutoLayout=api;
})(typeof window==='object'?window:globalThis);
