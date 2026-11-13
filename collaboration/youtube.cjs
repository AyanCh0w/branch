/* Public captions only. Never uses browser cookies or downloads video/audio. */
const cache=new Map(),inflight=new Map();
const MAX_TEXT=120000;
function stamp(seconds){const n=Math.max(0,Math.floor(seconds));return n>=3600?`${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`:`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
function normalizeTranscript(id,result){
 const segments=result.segments||result;
 if(!Array.isArray(segments))throw Error('YouTube did not return readable captions.');
 const lines=segments.filter(s=>typeof s.text==='string'&&s.text.trim()&&Number.isFinite(s.offset)&&s.offset>=0).map(s=>`[${stamp(s.offset)}] ${s.text.replace(/\s+/g,' ').trim()}`);
 if(!lines.length)throw Error('This video has no readable captions.');
 const text=lines.join('\n');if(text.length>MAX_TEXT)throw Error('This transcript is too long to attach in full. Use a shorter video or attach a relevant excerpt as a note.');
 return {id,text,language:String(segments[0]?.lang||'und').slice(0,32),title:String(result.videoDetails?.title||'').slice(0,200),segments:lines.length};
}
function publicError(error){const name=error?.name||'';
 if(/Disabled|NotAvailableLanguage|NotAvailable/.test(name))return 'YouTube has no available captions for this video. Add a transcript as a context note, or try another video.';
 if(/Unavailable/.test(name))return 'This video is unavailable or restricted. Public captions could not be retrieved.';
 if(/TooMany|Blocked/.test(name))return 'YouTube is temporarily blocking caption requests. Try again later, or add a transcript as a context note.';
 if(/Abort|Timeout/.test(name))return 'Caption retrieval timed out. Try again.';
 return 'Could not retrieve YouTube captions. Try again, or add a transcript as a context note.';
}
async function getTranscript(id,{provider}={}){
 if(!/^[\w-]{11}$/.test(id||''))throw Error('Use a valid YouTube video ID.');
 const cached=cache.get(id);if(cached&&cached.expires>Date.now())return cached.data;
 if(inflight.has(id))return inflight.get(id);
 if(inflight.size>=4)throw Error('Several transcripts are loading. Try again shortly.');
 const task=(async()=>{
  let result;
  try{const fetchTranscript=provider||(await import('youtube-transcript-plus')).fetchTranscript;
   // Prefer English where available; otherwise preserve the original caption language.
   const options={videoDetails:true,signal:AbortSignal.timeout(30000),retries:0};
   try{result=await fetchTranscript(id,{...options,lang:'en'});}catch(error){if(error.name!=='YoutubeTranscriptNotAvailableLanguageError')throw error;result=await fetchTranscript(id,options);}
  }catch(error){throw Error(publicError(error));}
  const data=normalizeTranscript(id,result);if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(id,{data,expires:Date.now()+3600000});return data;
 })();inflight.set(id,task);try{return await task;}finally{inflight.delete(id);}
}
module.exports={getTranscript,normalizeTranscript,publicError};
