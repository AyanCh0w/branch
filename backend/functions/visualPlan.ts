import { v } from '../validation';
import type { MutationCtx } from '../definitions';
import type { Id } from '../types';
import { savePlan } from './planning';

export const stepsValidator = v.array(v.object({ title:v.string(), status:v.union(v.literal('pending'),v.literal('working'),v.literal('done'),v.literal('blocked')), detail:v.string() }));
// Entry point for the in-app research agent and older MCP clients. The plan is stored
// as structured steps so the canvas shows a checklist instead of paragraphs.
export async function writePlan(ctx:MutationCtx, boardId:Id<'boards'>, userId:Id<'users'>, key:string, goal:string, steps:any[], expectedVersion?:number, origin?:any) {
 if(!goal.trim()||goal.length>4000||!steps.length||steps.length>200||steps.some(s=>!s.title.trim()||s.title.length>200||s.detail.length>4000||!['pending','working','done','blocked'].includes(s.status)))throw Error('Use a goal and short plan steps');
 const user=await ctx.db.get(userId);
 const agent=origin?.agentName||('Agent'+(user?.name?' · '+user.name:''));
 const result=await savePlan(ctx,{boardId,userId,agent,client:'Agent'},{key,title:'Work plan',goal,expectedVersion,origin,silent:!!origin,
  steps:steps.map(s=>({title:s.title.replace(/\s+/g,' ').trim().slice(0,80),status:s.status,detail:s.detail}))});
 return {id:result.id,version:result.version};
}
