import type {Id} from './_generated/dataModel';
import { pruneBoardAgents } from './maintenance';
import type {QueryCtx,MutationCtx} from './_generated/server';
import { query, mutation } from './_generated/server';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import { components } from './_generated/api';
import { access, tokenHash } from './access';
import { loadDocument, readText } from './documents';
const role=v.union(v.literal('viewer'),v.literal('editor'));
async function liveLink(ctx:QueryCtx|MutationCtx,token:string){if(!/^[a-f0-9]{64}$/.test(token))throw Error('This link is not valid');const hash=await tokenHash(token);const link=await ctx.db.query('boardLinks').withIndex('token',q=>q.eq('tokenHash',hash)).unique();if(!link||link.revoked||(link.expiresAt&&link.expiresAt<=Date.now()))throw Error('This link has expired or been turned off');const board=await ctx.db.get(link.boardId);if(!board||board.archived)throw Error('This board is unavailable');return {link,board};}
export const preview=query({args:{linkToken:v.string()},handler:async(ctx,args)=>{
  const {link,board}=await liveLink(ctx,args.linkToken);return {title:board.title,role:link.role,ownerName:(await ctx.db.get(board.ownerId))?.name||'Board owner'};
}});
export const settings=query({args:{boardId:v.id('boards')},handler:async(ctx,args)=>{
  const {membership,board,userId}=await access(ctx,'',args.boardId);if(membership.role!=='owner')return {owner:false,links:[],members:[]};
  const links=await ctx.db.query('boardLinks').withIndex('board',q=>q.eq('boardId',args.boardId)).collect();
  const members=await ctx.db.query('boardMembers').withIndex('board_user',q=>q.eq('boardId',args.boardId)).collect();
  const teamMembers=board.teamId?await ctx.db.query('teamMembers').withIndex('team_user',q=>q.eq('teamId',board.teamId!)).collect():[];
  return {owner:true,teamId:board.teamId||null,canOpenWorkspace:teamMembers.some(m=>m.userId===userId),teamName:board.teamId?(await ctx.db.get(board.teamId))?.name:null,links:links.filter(l=>!l.revoked&&(!l.expiresAt||l.expiresAt>Date.now())).map(l=>({id:l._id,label:l.label||'Guest link',role:l.role,expiresAt:l.expiresAt})),members:await Promise.all(members.map(async m=>({id:m._id,userId:m.userId,name:(await ctx.db.get(m.userId))?.name||'Member',color:(await ctx.db.get(m.userId))?.color||'#6685cf',responsibility:(await ctx.db.query('projectResponsibilities').withIndex('board_user',q=>q.eq('boardId',args.boardId).eq('userId',m.userId)).unique())?.responsibility??m.responsibility??'',role:m.role,teamAccess:teamMembers.some(t=>t.userId===m.userId),isOwner:m.userId===board.ownerId})))};
}});
// Suggestions only expose people in the signed-in owner's teams.
export const teammates=query({args:{boardId:v.id('boards')},handler:async(ctx,args)=>{
 const {board,membership}=await access(ctx,'',args.boardId);
 if(membership.role!=='owner')return [];
 const userId=await getAuthUserId(ctx);if(!userId)return [];
 const teams=await ctx.db.query('teamMembers').withIndex('user',q=>q.eq('userId',userId)).collect();
 const people=new Map<Id<'users'>,{userId:Id<'users'>,teamAccess:boolean}>();
 for(const team of teams){
  const rows=await ctx.db.query('teamMembers').withIndex('team_user',q=>q.eq('teamId',team.teamId)).collect();
  for(const row of rows){
   if(row.userId===userId)continue;
   const previous=people.get(row.userId);
   people.set(row.userId,{userId:row.userId,teamAccess:previous?.teamAccess||team.teamId===board.teamId});
  }
 }
 return await Promise.all([...people.values()].map(async person=>{
  const user=await ctx.db.get(person.userId);
  const username=await ctx.runQuery(components.authUsername.public.getUsername,{userId:person.userId});
  return {...person,username,name:user?.name||username||'Member',color:user?.color||'#6685cf'};
 }));
}});
export const createLink=mutation({args:{boardId:v.id('boards'),role,label:v.string(),linkToken:v.string()},handler:async(ctx,args)=>{
  const {membership}=await access(ctx,'',args.boardId);if(membership.role!=='owner')throw Error('Only the owner can share this board');
  if(!/^[a-f0-9]{64}$/.test(args.linkToken))throw Error('Invalid link token');
  const tokenHashValue=await tokenHash(args.linkToken);
  const existing=await ctx.db.query('boardLinks').withIndex('token',q=>q.eq('tokenHash',tokenHashValue)).unique();if(existing)throw Error('Create a fresh link');
  return ctx.db.insert('boardLinks',{boardId:args.boardId,tokenHash:tokenHashValue,role:args.role,label:args.label.trim().slice(0,60)||'Guest link',revoked:false});
}});
export const revokeLink=mutation({args:{linkId:v.id('boardLinks')},handler:async(ctx,args)=>{
  const link=await ctx.db.get(args.linkId);if(!link)throw Error('Link not found');const {membership}=await access(ctx,'',link.boardId);if(membership.role!=='owner')throw Error('Only the owner can change sharing');await ctx.db.patch(link._id,{revoked:true});await pruneBoardAgents(ctx,link.boardId);
}});
export const changeLinkRole=mutation({args:{linkId:v.id('boardLinks'),role},handler:async(ctx,args)=>{
  const link=await ctx.db.get(args.linkId);if(!link)throw Error('Link not found');const {membership}=await access(ctx,'',link.boardId);if(membership.role!=='owner')throw Error('Only the owner can change sharing');await ctx.db.patch(link._id,{role:args.role});await pruneBoardAgents(ctx,link.boardId);
}});
export const join=mutation({args:{linkToken:v.string()},handler:async(ctx,args)=>{
  const userId=await getAuthUserId(ctx);if(!userId)throw Error('Sign in first');const {link}=await liveLink(ctx,args.linkToken);
  const existing=await ctx.db.query('linkMembers').withIndex('board_user',q=>q.eq('boardId',link.boardId).eq('userId',userId)).collect();
  if(!existing.some(g=>g.linkId===link._id))await ctx.db.insert('linkMembers',{boardId:link.boardId,userId,linkId:link._id});
  return link.boardId;
}});
export const joinGuest=mutation({args:{linkToken:v.string(),name:v.string(),sessionToken:v.string()},handler:async(ctx,args)=>{
  const {link}=await liveLink(ctx,args.linkToken);const name=args.name.trim();if(!name||name.length>40)throw Error('Enter a name');if(!/^[a-f0-9]{64}$/.test(args.sessionToken))throw Error('Invalid session');
  if(link.lastGuestAt&&Date.now()-link.lastGuestAt<1000)throw Error('Try again in a moment');
  const userId=await ctx.db.insert('users',{name,kind:'guest'});
  await ctx.db.insert('sessions',{tokenHash:await tokenHash(args.sessionToken),userId,expiresAt:Date.now()+86400000});
  await ctx.db.insert('linkMembers',{boardId:link.boardId,userId,linkId:link._id});
  await ctx.db.patch(link._id,{lastGuestAt:Date.now()});return {boardId:link.boardId,userId,name,role:link.role};
}});
export const addMember=mutation({args:{boardId:v.id('boards'),username:v.string(),role,responsibility:v.optional(v.string())},handler:async(ctx,args)=>{
  if((args.responsibility||'').length>1000)throw Error('Keep responsibilities under 1,000 characters');const {board,membership}=await access(ctx,'',args.boardId);if(membership.role!=='owner')throw Error('Only the owner can invite people');
  const userId=await ctx.runQuery(components.authUsername.public.getUserIdByUsername,{username:args.username.trim()});if(!userId)throw Error('No account has that username yet. Share an invite link instead.');
  if(userId===board.ownerId)throw Error('You already own this board');
  const existing=await ctx.db.query('boardMembers').withIndex('board_user',q=>q.eq('boardId',args.boardId).eq('userId',userId as any)).unique();
  if(args.responsibility!==undefined){const override=await ctx.db.query('projectResponsibilities').withIndex('board_user',q=>q.eq('boardId',args.boardId).eq('userId',userId as any)).unique();if(override)await ctx.db.patch(override._id,{responsibility:args.responsibility.trim()});}
  if(existing)await ctx.db.patch(existing._id,{role:args.role,...(args.responsibility!==undefined?{responsibility:args.responsibility.trim()}:{})});else await ctx.db.insert('boardMembers',{boardId:args.boardId,userId:userId as any,role:args.role,responsibility:args.responsibility?.trim()});
}});
export const removeMember=mutation({args:{memberId:v.id('boardMembers')},handler:async(ctx,args)=>{
  const member=await ctx.db.get(args.memberId);if(!member)throw Error('Member not found');const {board,membership}=await access(ctx,'',member.boardId);if(membership.role!=='owner'||member.userId===board.ownerId)throw Error('Cannot remove this member');await ctx.db.delete(member._id);await pruneBoardAgents(ctx,member.boardId);
}});

export const setResponsibility=mutation({args:{memberId:v.id('boardMembers'),responsibility:v.string()},handler:async(ctx,args)=>{
 const row=await ctx.db.get(args.memberId);if(!row)throw Error('Member not found');const {userId,membership}=await access(ctx,'',row.boardId);
 if(userId!==row.userId&&membership.role!=='owner')throw Error('Only you or the board owner can edit your role');
 if(args.responsibility.length>1000)throw Error('Keep responsibilities under 1,000 characters');
 await ctx.db.patch(row._id,{responsibility:args.responsibility.trim()});
}});

// Changing general access updates every live link in one transaction, including
// people who already joined through a link. Direct and team access are separate.
export const setGeneralAccess=mutation({args:{boardId:v.id('boards'),role:v.union(role,v.literal('restricted'))},handler:async(ctx,args)=>{
 const {membership}=await access(ctx,'',args.boardId);if(membership.role!=='owner')throw Error('Only the owner can change sharing');
 const links=await ctx.db.query('boardLinks').withIndex('board',q=>q.eq('boardId',args.boardId)).collect();
 for(const link of links)if(!link.revoked)await ctx.db.patch(link._id,args.role==='restricted'?{revoked:true}:{role:args.role});
 await pruneBoardAgents(ctx,args.boardId);
}});
export const changeMemberRole=mutation({args:{memberId:v.id('boardMembers'),role},handler:async(ctx,args)=>{
 const member=await ctx.db.get(args.memberId);if(!member)throw Error('Member not found');
 const {board,membership}=await access(ctx,'',member.boardId);
 if(membership.role!=='owner'||member.userId===board.ownerId)throw Error('Only the owner can change member access');
 await ctx.db.patch(member._id,{role:args.role});
 await pruneBoardAgents(ctx,member.boardId);
}});

// A live invite is the capability: board IDs alone never expose preview data.
export const socialPreview=query({args:{linkToken:v.string()},handler:async(ctx,args)=>{
 const {board}=await liveLink(ctx,args.linkToken);
 const rows=await ctx.db.query('nodes').withIndex('board_key',q=>q.eq('boardId',board._id)).collect();
 const live=rows.filter(n=>!n.deleted);
 const nodes=live.slice(0,100).map(n=>{
  const doc=loadDocument(n.textState),text=readText(doc);doc.destroy();
  const d=n.data;
  return {key:n.key,type:String(d.type||'note'),x:Number(d.x)||0,y:Number(d.y)||0,width:Number(d.width)||380,height:Number(d.layoutHeight||d.minHeight)||240,title:String(text.title||d.title||'Untitled').slice(0,100),body:String(text.body||d.messages?.at(-1)?.text||d.messages?.at(-1)?.content||'').slice(0,400),connections:(d.contexts||[]).slice(0,30).map((c:any)=>String(c.source))};
 });
 return {title:board.title,count:live.length,nodes};
}});
