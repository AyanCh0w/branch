import {randomUUID} from 'node:crypto';
import schema from './schema';
import {encode,decode} from './codec';
export class Store {
 affectedUsers=new Set<string>();affectedBoards=new Set<string>();affectedTeams=new Set<string>();
 constructor(public sql:any,public writable=false){}
 touch(collection:string,id:string,data:any){
  for(const key of ['userId','ownerId','initiatedBy'])if(data[key])this.affectedUsers.add(data[key]);
  if(collection==='users')this.affectedUsers.add(id);
  if(data.boardId)this.affectedBoards.add(data.boardId);
  if(collection==='boards')this.affectedBoards.add(id);
  if(data.teamId)this.affectedTeams.add(data.teamId);
  if(collection==='teams')this.affectedTeams.add(id);
 }
 system={get:(id:string)=>this.get(id),normalizeId:(_table:string,id:string)=>this.normalizeId('_storage',id)};
 normalizeId(_table:string,id:string){return typeof id==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(id)?id:null;}
 async get(id:string){const {rows}=await this.sql.query('select * from branch_private.records where id=$1',[id]);return rows[0]?{...decode(rows[0].data),_id:rows[0].id,_creationTime:rows[0].created_at}:null;}
 query(collection:string){
  if(!Object.hasOwn(schema,collection)&&collection!=='_storage')throw Error('Unknown collection');
  const clauses:any[]=[];const build:any={
   withIndex:(_name:string,fn?:any)=>{if(fn){const q:any={eq:(key:string,value:any)=>{clauses.push([key,value]);return q;}};fn(q);}return build;},
   filter:(fn:any)=>{fn({field:(key:string)=>key,eq:(key:string,value:any)=>clauses.push([key,value])});return build;},
   collect:async()=>{
    const values:any[]=[collection];let where='collection=$1';
    for(const [key,value] of clauses){values.push(key,JSON.stringify(encode(value)));where+=` and data->$${values.length-1} = $${values.length}::jsonb`;}
    const {rows}=await this.sql.query(`select * from branch_private.records where ${where} order by created_at,id`,values);
    return rows.map((r:any)=>({...decode(r.data),_id:r.id,_creationTime:r.created_at}));
   },
   first:async()=> (await build.collect())[0]||null,
   unique:async()=>{const rows=await build.collect();if(rows.length>1)throw Error('Duplicate records');return rows[0]||null;},
   [Symbol.asyncIterator]:async function*(){yield* await build.collect();}
  };return build;
 }
 check(){if(!this.writable)throw Error('Read-only transaction');}
 validate(collection:string,data:any){if(collection!=='_storage')(schema as any)[collection].validator.parse(data);}
 async insert(collection:string,data:any){this.check();this.validate(collection,data);const id=collection+'_'+randomUUID().replaceAll('-','');await this.sql.query('insert into branch_private.records(id,collection,created_at,data) values($1,$2,$3,$4)',[id,collection,Date.now(),JSON.stringify(encode(data))]);this.touch(collection,id,data);return id;}
 async patch(id:string,patch:any){this.check();const {rows}=await this.sql.query('select * from branch_private.records where id=$1',[id]);if(!rows[0])throw Error('Record not found');const data=decode(rows[0].data);this.touch(rows[0].collection,id,data);for(const [key,value] of Object.entries(patch)){if(key.startsWith('_'))throw Error('Immutable field');if(value===undefined)delete data[key];else data[key]=value;}this.validate(rows[0].collection,data);this.touch(rows[0].collection,id,data);await this.sql.query('update branch_private.records set data=$2 where id=$1',[id,JSON.stringify(encode(data))]);}
 async replace(id:string,data:any){this.check();const {rows}=await this.sql.query('select collection from branch_private.records where id=$1',[id]);if(!rows[0])throw Error('Record not found');this.validate(rows[0].collection,data);this.touch(rows[0].collection,id,data);await this.sql.query('update branch_private.records set data=$2 where id=$1',[id,JSON.stringify(encode(data))]);}
 async delete(id:string){this.check();const {rows}=await this.sql.query('select collection,data from branch_private.records where id=$1',[id]);if(rows[0])this.touch(rows[0].collection,id,decode(rows[0].data));await this.sql.query('delete from branch_private.records where id=$1',[id]);}
}
