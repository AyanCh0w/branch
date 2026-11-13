(function(root){
 function videoId(raw){try{const u=new URL(raw),host=u.hostname.toLowerCase().replace(/^www\./,'');let id='';if(!['http:','https:'].includes(u.protocol))return null;if(host==='youtu.be')id=u.pathname.slice(1).split('/')[0];else if(['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)){id=u.searchParams.get('v')||(/^\/(embed|shorts|live)\//.test(u.pathname)?u.pathname.split('/')[2]:'')}return /^[a-zA-Z0-9_-]{11}$/.test(id)?id:null}catch{return null}}
 function httpsURL(raw){try{const u=new URL(raw);return u.protocol==='https:'?u.href:null}catch{return null}}
 const api={videoId,httpsURL};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BranchMedia=api;
})(typeof globalThis!=='undefined'?globalThis:this);
