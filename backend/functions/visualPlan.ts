import { touchBoard } from './access';
import { v } from '../validation';
import type { MutationCtx } from '../definitions';
import type { Id } from '../types';
import { initialDocument, loadDocument, encodeDocument, withText, patchNode } from './documents';
import { place } from '../../app/auto-layout.js';

export const stepsValidator = v.array(v.object({ title:v.string(), status:v.union(v.literal('pending'),v.literal('working'),v.literal('done'),v.literal('blocked')), detail:v.string() }));
export async function writePlan(ctx:MutationCtx, boardId:Id<'boards'>, userId:Id<'users'>, key:string, goal:string, steps:any[], expectedVersion?:number, origin?:any, options?:{title?:string,near?:{x:number,y:number}}) {
 if(!goal.trim()||goal.length>4000||!steps.length||steps.length>12||steps.some(s=>!s.title.trim()||s.title.length>200||s.detail.length>4000||!['pending','working','done','blocked'].includes(s.status)))throw Error('Use a goal and 1–12 short plan steps');
 const stored=await ctx.db.query('nodes').withIndex('board_key',q=>q.eq('boardId',boardId).eq('key',key)).unique();
 const row=stored?await withText(ctx,stored):null;
 const body=goal+'\n\n'+steps.map((s,i)=>`${i+1}. ${s.title} — ${s.status}\n${s.detail}`).join('\n\n');
 if(row){
  if(row.deleted||!row.data.visualPlan||row.createdBy!==userId)throw Error('This plan cannot be updated');
  if(expectedVersion!==undefined&&row.textVersion!==expectedVersion)throw Error('Plan changed. Read the board before updating.');
  const editors=await ctx.db.query('editors').withIndex('node',q=>q.eq('boardId',boardId).eq('nodeKey',key)).collect();
  if(editors.some(e=>e.expiresAt>Date.now()))throw Error('Someone is editing this plan. Try again after they finish.');
  const doc=loadDocument(row.textState),text=doc.getText('body');
  // Never overwrite manual edits, even after the editor lease has expired.
  if(text.toString()!==row.data.planBody){doc.destroy();throw Error('Plan was manually edited. Create a new plan to preserve those edits.');}
  text.delete(0,text.length);text.insert(0,body);
  // A new revision marks chats holding the old plan snapshot as stale; they refresh explicitly.
  const revision=(row.data.revision||1)+(body!==row.data.planBody?1:0);
  await patchNode(ctx,row,{textState:encodeDocument(doc),textVersion:row.textVersion+1,data:{...row.data,planBody:body,revision},updatedBy:userId});doc.destroy();
  await touchBoard(ctx,boardId);return {id:key,version:row.textVersion+1};
 }
 if(expectedVersion!==undefined&&expectedVersion!==-1)throw Error('Plan not found');
 const rows=await ctx.db.query('nodes').withIndex('board_key',q=>q.eq('boardId',boardId)).collect();
 const location=place(rows.filter(n=>!n.deleted).map(n=>n.data),{x:origin?origin.x+(origin.width||520)+100:options?.near?.x??80,y:origin?.y||options?.near?.y||80},420,600);
 const data={id:key,type:'plan',title:options?.title||'Work plan',body,...location,width:420,revision:1,visualPlan:true,planBody:body,...(origin?{autoGroup:origin.id}:{}),contexts:[]};
 await ctx.db.insert('nodes',{boardId,key,data,textState:initialDocument(data),textVersion:0,createdBy:userId,updatedBy:userId,deleted:false});
 await touchBoard(ctx,boardId);return {id:key,version:0};
}
