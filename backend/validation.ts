export type RecordReference = { id: string; table: string; path: string };
export type Validator = {
 parse(value: any, path?: string): any;
 optional?: boolean;
 sql?: {type:string; reference?:string; values?:any[]};
 references?(value: any, path?: string): RecordReference[];
};
const rule = (test: (x: any) => boolean, label: string, sql: Validator['sql']={type:'jsonb'}): Validator => ({
 sql,
 parse(value, path='value') {
  if (!test(value)) throw new InputError(`Invalid ${path}: expected ${label}`);
  return value;
 }
});
const refs = (type: Validator, value: any, path='value') => type.references?.(value,path)||[];
export class InputError extends Error {}
export const v = {
 string:()=>rule(x=>typeof x==='string','string',{type:'text'}),
 number:()=>rule(x=>typeof x==='number'&&Number.isFinite(x),'finite number',{type:'double precision'}),
 boolean:()=>rule(x=>typeof x==='boolean','boolean',{type:'boolean'}),
 null:()=>rule(x=>x===null,'null'), any:()=>rule(()=>true,'value'),
 bytes:()=>rule(x=>x instanceof ArrayBuffer,'bytes'),
 id:(table:string):Validator=>({
  ...rule(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(x),'record ID'),
  sql:{type:'text',reference:table},
  references:(id,path='value')=>[{id,table,path}],
 }),
 literal:(expected:any)=>rule(x=>x===expected,JSON.stringify(expected),{type:typeof expected==='string'?'text':'jsonb',values:[expected]}),
 optional:(type:Validator):Validator=>({optional:true,sql:type.sql,
  parse:(x,p)=>x===undefined?undefined:type.parse(x,p),
  references:(x,p)=>x===undefined?[]:refs(type,x,p),
 }),
 array:(type:Validator):Validator=>({
  parse(x,p='value') {
   if(!Array.isArray(x)||x.length>20000)throw new InputError(`Invalid ${p}: expected array`);
   return x.map((item,i)=>type.parse(item,`${p}[${i}]`));
  }, references:(x,p='value')=>x.flatMap((item:any,i:number)=>refs(type,item,`${p}[${i}]`)),
 }),
 object:(shape:Record<string,Validator>):Validator=>({
  parse(x,p='value') {
   if(!x||typeof x!=='object'||Array.isArray(x))throw new InputError(`Invalid ${p}: expected object`);
   for(const key of Object.keys(x))if(!Object.hasOwn(shape,key))throw new InputError(`Unexpected ${p}.${key}`);
   for(const [key,type] of Object.entries(shape))type.parse(x[key],`${p}.${key}`);
   return x;
  }, references:(x,p='value')=>Object.entries(shape).flatMap(([key,type])=>refs(type,x[key],`${p}.${key}`)),
 }),
 union:(...types:Validator[]):Validator=>({
  sql:types.every(t=>t.sql?.values&&t.sql.type==='text')?{type:'text',values:types.flatMap(t=>t.sql!.values!)}:{type:'jsonb'},
  parse(x,p){for(const type of types){try{return type.parse(x,p);}catch{}}throw new InputError(`Invalid ${p||'value'}`);},
  references(x,p){for(const type of types){try{type.parse(x,p);return refs(type,x,p);}catch{}}return [];},
 }),
};
// Legacy IDs remain stable across migration. Check their stored collection before
// invoking a handler; a syntactically valid board ID cannot stand in for a member ID.
export async function validateReferences(sql:any,type:Validator,value:any) {
 const references=refs(type,value);
 if(!references.length)return;
 const {rows}=await sql.query('select id,collection from branch_private.record_ids where id=any($1::text[])',[[...new Set(references.map(r=>r.id))]]);
 const tables=new Map(rows.map((r:any)=>[r.id,r.collection]));
 for(const ref of references) {
  const table=tables.get(ref.id);
  if(table&&table!==ref.table)throw new InputError(`Invalid ${ref.path}: expected ${ref.table} ID`);
 }
}
