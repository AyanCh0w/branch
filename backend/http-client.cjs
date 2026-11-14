class BranchHttpClient {
 constructor(base){this.base=base;this.token='';}
 setAuth(token){this.token=token;}
 async request(payload){const r=await fetch(new URL('/api/backend',this.base),{method:'POST',headers:{'Content-Type':'application/json',...(this.token?{Authorization:'Bearer '+this.token}:{})},body:JSON.stringify(payload)});const result=await r.json();if(!r.ok)throw Error(result.error||'Request failed');return result;}
 query(name,args={}){return this.request({kind:'query',name,args}).then(r=>r.value);}
 mutation(name,args={}){if(name==='auth:signInWithUsernamePassword')return this.request({auth:'signin',args});if(name==='auth:refreshSession')return this.request({auth:'refresh',args});return this.request({kind:'mutation',name,args}).then(r=>r.value);}
}
module.exports={BranchHttpClient};
