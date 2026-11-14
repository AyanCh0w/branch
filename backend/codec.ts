// JSON wire representation shared by Postgres documents and the browser.
export function encode(value:any):any {
 if(value===undefined)return {$branch:'undefined'};
 if(value instanceof ArrayBuffer)return {$branch:'bytes',value:Buffer.from(value).toString('base64')};
 if(Array.isArray(value))return value.map(encode);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,encode(v)]));
 return value;
}
export function decode(value:any):any {
 if(value&&typeof value==='object'&&!Array.isArray(value)){
  if(value.$branch==='bytes'&&Object.keys(value).length===2){const b=Buffer.from(value.value,'base64');return Uint8Array.from(b).buffer;}
  if(value.$branch==='undefined'&&Object.keys(value).length===1)return undefined;
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));
 }
 return Array.isArray(value)?value.map(decode):value;
}
