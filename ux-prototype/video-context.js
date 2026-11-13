/* Resolve initial caption loads without refreshing an already-frozen transcript. */
(function(root){
 const MAX_TEXT=120000;
 function video(c){
  if(c.enabled===false||c.excerptOnly)return null;
  if(c.video?.id)return c.video;
  // Upgrade old link-only snapshots from their saved URL, never the current source node.
  const body=String(c.body||''),match=body.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})[^\s]*/);
  if(match&&!body.slice(match.index+match[0].length).trim())return {id:match[1],included:false};
  return null;
 }
 function pendingVideoIds(bindings){const ids=new Set();function visit(c){if(c.enabled===false)return;for(const a of c.inherited||[])visit(a);const v=video(c);if(v&&!v.included)ids.add(v.id);}bindings.forEach(visit);return [...ids];}
 function hydrateVideos(bindings,transcripts=[]){
  if(transcripts.length>8)throw Error('Connect up to eight new video transcripts per message.');
  const byId=new Map();for(const t of transcripts){if(!/^[\w-]{11}$/.test(t.id)||typeof t.text!=='string'||!t.text.trim()||t.text.length>MAX_TEXT)throw Error('Invalid video transcript');byId.set(t.id,t);}
  let chars=0;
  function hydrate(c){const next={...c};if(c.enabled===false)return next;next.inherited=(c.inherited||[]).map(hydrate);const v=video(c);if(!v||v.included)return next;
   const t=byId.get(v.id);if(!t)throw Error('The transcript for “'+(c.title||'YouTube video')+'” is not available. Retry captions on its video card, or detach this context before sending.');
   chars+=t.text.length;if(chars>300000)throw Error('Too many video captions for one message. Connect fewer videos.');
   next.body=String(c.body||'')+'\n\nYouTube captions (spoken content; may contain automatic-caption errors). Language: '+String(t.language||'und').slice(0,32)+'\n'+t.text;
   next.video={id:v.id,included:true,language:String(t.language||'und').slice(0,32)};delete next.availability;return next;
  }
  return bindings.map(hydrate);
 }
 const api={pendingVideoIds,hydrateVideos};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BranchVideoContext=api;
})(typeof globalThis!=='undefined'?globalThis:this);
