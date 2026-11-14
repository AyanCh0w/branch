// pg removes its idle error listener while a client is checked out. A socket
// may fail between SQL queries (for example during a Storage request).
export function guardConnection(sql:any){
 let failure:Error|undefined;
 const onError=()=>{failure=new Error('Database connection interrupted');};
 sql.on?.('error',onError);
 return {
  get failure(){return failure;},
  assertHealthy(){if(failure)throw failure;},
  async rollback(){if(!failure)try{await sql.query('rollback');}catch{onError();}},
  release(){try{sql.release(failure);}finally{sql.removeListener?.('error',onError);}},
 };
}
