// Live previews are immediate. Durable writes are batched independently, even
// when edits arrive during a slow write. Send/blur/navigation explicitly drain.
export function createSaveScheduler({save,hasPending=()=>false,delay=1000}){
 let timer=null,running=null,dirty=false;
 function schedule(){
  dirty=true;
  if(timer!==null||running)return;
  timer=setTimeout(()=>{timer=null;run(false).catch(()=>{});},delay);
 }
 async function run(force){
  clearTimeout(timer);timer=null;
  if(running){await running;if(running||dirty||hasPending())return run(force);return;}
  dirty=false;running=Promise.resolve().then(save);
  try{await running;}finally{running=null;}
  if(dirty||hasPending()){
   if(force)return run(true);
   schedule();
  }
 }
 return {schedule,flush:()=>run(true),cancel(){clearTimeout(timer);timer=null;dirty=false;}};
}
