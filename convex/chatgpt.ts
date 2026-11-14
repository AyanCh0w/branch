import {query,mutation,internalQuery,internalMutation} from './_generated/server';
import {v} from 'convex/values';
import {getAuthUserId} from '@convex-dev/auth/server';
import {access} from './access';
export const connectionForUser=(ctx:any,userId:any)=>ctx.db.query('chatgptConnections').withIndex('user',(q:any)=>q.eq('userId',userId)).unique();
const models=v.array(v.object({slug:v.string(),name:v.string()}));
export const status=query({args:{},handler:async ctx=>{
 const userId=await getAuthUserId(ctx),row=userId?await connectionForUser(ctx,userId):null;
 const available=process.env.CHATGPT_HOSTED_APPROVED==='true'&&!!process.env.CHATGPT_CLIENT_ID&&!!process.env.CHATGPT_REDIRECT_URI&&!!process.env.CHATGPT_ENCRYPTION_KEY;
 return {available,connected:!!row,label:row?.label||'',models:row?.models||[],selectedModel:row?.selectedModel||'gpt-5.4-mini'};
}});
export const chooseModel=mutation({args:{model:v.string()},handler:async(ctx,{model})=>{const userId=await getAuthUserId(ctx);if(!userId)throw Error('Sign in first');const row=await connectionForUser(ctx,userId);if(!row||!row.models.some((m:any)=>m.slug===model))throw Error('This model is not available for your ChatGPT connection.');await ctx.db.patch(row._id,{selectedModel:model});}});
export const get=internalQuery({args:{userId:v.id('users')},handler:(ctx,a)=>connectionForUser(ctx,a.userId)});
export const authorizeBoard=internalQuery({args:{boardId:v.id('boards'),token:v.string()},handler:async(ctx,a)=>(await access(ctx,a.token,a.boardId,true)).userId});
export const begin=internalMutation({args:{userId:v.id('users'),stateHash:v.string(),browserHash:v.string(),ciphertext:v.string(),expiresAt:v.number()},handler:async(ctx,a)=>{
 const old=await ctx.db.query('chatgptTransactions').withIndex('user',q=>q.eq('userId',a.userId)).collect();for(const row of old)await ctx.db.delete(row._id);
 const connection=await connectionForUser(ctx,a.userId);await ctx.db.insert('chatgptTransactions',{...a,...(connection?{connectionId:connection._id}:{})});
}});
export const consume=internalMutation({args:{stateHash:v.string(),browserHash:v.string()},handler:async(ctx,a)=>{const row=await ctx.db.query('chatgptTransactions').withIndex('state',q=>q.eq('stateHash',a.stateHash)).unique();if(!row||row.consumed||row.expiresAt<=Date.now()||row.browserHash!==a.browserHash)throw Error('Sign-in expired or could not be verified. Try connecting again.');await ctx.db.patch(row._id,{consumed:true});return row;}});
export const connect=internalMutation({args:{transactionId:v.id('chatgptTransactions'),userId:v.id('users'),connectionId:v.optional(v.id('chatgptConnections')),ciphertext:v.string(),subject:v.string(),clientId:v.string(),label:v.string(),models,expiresAt:v.number()},handler:async(ctx,a)=>{
 const tx=await ctx.db.get(a.transactionId);if(!tx||!tx.consumed||tx.expiresAt<=Date.now()||tx.userId!==a.userId)throw Error('Sign-in expired. Try again.');await ctx.db.delete(tx._id);
 const existing=await connectionForUser(ctx,a.userId);if(existing?._id!==a.connectionId)throw Error('The connection changed. Start sign-in again.');
 const {connectionId,transactionId,...fields}=a;const selectedModel=existing&&a.models.some(m=>m.slug===existing.selectedModel)?existing.selectedModel:(a.models.find(m=>m.slug==='gpt-5.4-mini')||a.models[0])?.slug||'';
 // A new row makes every reconnect a distinct generation; queued work cannot switch accounts.
 if(existing)await ctx.db.delete(existing._id);await ctx.db.insert('chatgptConnections',{...fields,selectedModel,revision:0});
}});
export const lock=internalMutation({args:{id:v.id('chatgptConnections'),revision:v.number(),lease:v.string()},handler:async(ctx,a)=>{const row=await ctx.db.get(a.id);if(!row||row.revision!==a.revision||row.refreshUntil&&row.refreshUntil>Date.now())return false;await ctx.db.patch(a.id,{refreshLease:a.lease,refreshUntil:Date.now()+30000});return true;}});
export const renewed=internalMutation({args:{id:v.id('chatgptConnections'),lease:v.string(),ciphertext:v.string(),expiresAt:v.number()},handler:async(ctx,a)=>{const row=await ctx.db.get(a.id);if(!row||row.refreshLease!==a.lease)throw Error('ChatGPT connection changed. Retry.');await ctx.db.patch(a.id,{ciphertext:a.ciphertext,expiresAt:a.expiresAt,revision:row.revision+1,refreshLease:undefined,refreshUntil:undefined});}});
export const unlock=internalMutation({args:{id:v.id('chatgptConnections'),lease:v.string()},handler:async(ctx,a)=>{const row=await ctx.db.get(a.id);if(row?.refreshLease===a.lease)await ctx.db.patch(a.id,{refreshLease:undefined,refreshUntil:undefined});}});
export const setModels=internalMutation({args:{id:v.id('chatgptConnections'),models},handler:async(ctx,a)=>{const row=await ctx.db.get(a.id);if(!row)return;await ctx.db.patch(a.id,{models:a.models,selectedModel:a.models.some(m=>m.slug===row.selectedModel)?row.selectedModel:a.models[0]?.slug||''});}});
export const remove=internalMutation({args:{userId:v.id('users')},handler:async(ctx,a)=>{const row=await connectionForUser(ctx,a.userId);if(row)await ctx.db.delete(row._id);const pending=await ctx.db.query('chatgptTransactions').withIndex('user',q=>q.eq('userId',a.userId)).collect();for(const tx of pending)await ctx.db.delete(tx._id);return row;}});

export const boardConnection=query({args:{boardId:v.id('boards'),token:v.string()},handler:async(ctx,a)=>{const {userId}=await access(ctx,a.token,a.boardId,true);return !!await connectionForUser(ctx,userId);}});
