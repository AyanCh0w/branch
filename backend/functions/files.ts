import {randomBytes,createHash} from 'node:crypto';
import { mutation, query } from '../definitions';
import { v } from '../validation';
import { access } from './access';
const auth = {token:v.string(),boardId:v.id('boards')};
export const uploadUrl = mutation({args:auth,handler:async(ctx,args)=>{
 const {userId}=await access(ctx,args.token,args.boardId,true);
 const ticket=await ctx.db.insert('fileUploads',{boardId:args.boardId,userId});
 const cap=randomBytes(32).toString('hex');
 const upload=await ctx.db.insert('uploadTickets',{fileTicket:ticket,boardId:args.boardId,userId,hash:createHash('sha256').update(cap).digest('hex'),expiresAt:Date.now()+3600000,used:false});
 return {ticket,url:'/api/backend?upload=1&ticket='+upload+'&cap='+cap};
}});
export const finish = mutation({args:{...auth,ticket:v.id('fileUploads'),storageId:v.id('_storage')},handler:async(ctx,args)=>{
 const {userId}=await access(ctx,args.token,args.boardId,true);
 const ticket=await ctx.db.get(args.ticket),meta=await ctx.db.system.get(args.storageId);
 if(!ticket||ticket.boardId!==args.boardId||ticket.userId!==userId||ticket.storageId||Date.now()-ticket._creationTime>3600000)throw Error('Upload expired');
 if(!meta||meta.ticket!==args.ticket||meta.userId!==userId||meta.boardId!==args.boardId||meta._creationTime<ticket._creationTime||meta.size>25*1024*1024)throw Error('Invalid file or larger than 25 MB');
 const existing=await ctx.db.query('fileUploads').withIndex('storage',q=>q.eq('storageId',args.storageId)).first();
 if(existing)throw Error('File already registered');
 await ctx.db.patch(ticket._id,{storageId:args.storageId});
 return args.storageId;
}});
export async function fileForBoard(ctx:any,boardId:any,storageId:string){
 const id=ctx.db.system.normalizeId('_storage',storageId);if(!id)throw Error('Invalid file');
 const file=await ctx.db.query('fileUploads').withIndex('storage',(q:any)=>q.eq('storageId',id)).unique();
 if(!file||file.boardId!==boardId)throw Error('File is not available to this board');
 const meta=await ctx.db.system.get(id),url=await ctx.storage.getUrl(id);
 if(!meta||!url)throw Error('Context file is missing');
 return {url,mime:meta.contentType,size:meta.size};
}
export const read = query({args:{...auth,storageId:v.string()},handler:(ctx,args)=>access(ctx,args.token,args.boardId).then(()=>fileForBoard(ctx,args.boardId,args.storageId))});
