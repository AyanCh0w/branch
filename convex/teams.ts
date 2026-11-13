import {query,mutation} from './_generated/server';
import type {QueryCtx,MutationCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
import {v} from 'convex/values';
import {getAuthUserId} from '@convex-dev/auth/server';
import {components} from './_generated/api';
import {access} from './access';
async function member(ctx:QueryCtx|MutationCtx,teamId:Id<'teams'>,owner=false){
 const userId=await getAuthUserId(ctx);if(!userId)throw Error('Sign in first');
 const team=await ctx.db.get(teamId);if(!team)throw Error('Team not found');
 const membership=await ctx.db.query('teamMembers').withIndex('team_user',q=>q.eq('teamId',teamId).eq('userId',userId)).unique();
 if(!membership||(owner&&team.ownerId!==userId))throw Error(owner?'Only the team owner can manage members':'Team access denied');return {team,userId,membership};
}
export const list=query({args:{},handler:async ctx=>{
 const userId=await getAuthUserId(ctx);if(!userId)return [];
 const memberships=await ctx.db.query('teamMembers').withIndex('user',q=>q.eq('userId',userId)).collect();
 const teams=await Promise.all(memberships.map(async m=>{const team=await ctx.db.get(m.teamId);if(!team)return null;const people=await ctx.db.query('teamMembers').withIndex('team_user',q=>q.eq('teamId',m.teamId)).collect();return {id:team._id,name:team.name,description:team.description||'',owner:team.ownerId===userId,count:people.length};}));
 return teams.filter(t=>t!==null).sort((a,b)=>a.name.localeCompare(b.name));
}});
export const create=mutation({args:{name:v.string()},handler:async(ctx,args)=>{
 const userId=await getAuthUserId(ctx);if(!userId)throw Error('Sign in first');const name=args.name.trim();if(!name||name.length>60)throw Error('Use a team name between 1 and 60 characters');
 const teamId=await ctx.db.insert('teams',{name,ownerId:userId});await ctx.db.insert('teamMembers',{teamId,userId,role:'owner'});return teamId;
}});
export const details=query({args:{teamId:v.id('teams')},handler:async(ctx,args)=>{
 if(!await ctx.db.get(args.teamId))return null;
 const {team,userId}=await member(ctx,args.teamId);const members=await ctx.db.query('teamMembers').withIndex('team_user',q=>q.eq('teamId',args.teamId)).collect();
 const boards=await ctx.db.query('boards').withIndex('team',q=>q.eq('teamId',args.teamId)).collect();
 return {boardCount:boards.filter(b=>!b.archived).length,name:team.name,description:team.description||'',owner:team.ownerId===userId,members:await Promise.all(members.map(async m=>{const user=await ctx.db.get(m.userId);const username=await ctx.runQuery(components.authUsername.public.getUsername,{userId:m.userId});return {id:m._id,name:user?.name||username||'Member',username,color:user?.color||'#6685cf',responsibility:m.responsibility||'',canEdit:team.ownerId===userId||m.userId===userId,isOwner:m.userId===team.ownerId};}))};
}});
export const addMember=mutation({args:{teamId:v.id('teams'),username:v.string(),responsibility:v.optional(v.string())},handler:async(ctx,args)=>{
 if((args.responsibility||'').length>1000)throw Error('Keep responsibilities under 1,000 characters');await member(ctx,args.teamId,true);const userId=await ctx.runQuery(components.authUsername.public.getUserIdByUsername,{username:args.username.trim().replace(/^@/,'')});if(!userId)throw Error('No account has that username yet. Ask them to create an account first.');
 const existing=await ctx.db.query('teamMembers').withIndex('team_user',q=>q.eq('teamId',args.teamId).eq('userId',userId as Id<'users'>)).unique();if(existing)throw Error('This person is already in the team');
 await ctx.db.insert('teamMembers',{teamId:args.teamId,userId:userId as Id<'users'>,role:'member',responsibility:args.responsibility?.trim()});
}});
export const removeMember=mutation({args:{memberId:v.id('teamMembers')},handler:async(ctx,args)=>{
 const row=await ctx.db.get(args.memberId);if(!row)throw Error('Member not found');const {team}=await member(ctx,row.teamId,true);if(row.userId===team.ownerId)throw Error('The owner cannot be removed');await ctx.db.delete(row._id);
}});
export const rename=mutation({args:{teamId:v.id('teams'),name:v.string()},handler:async(ctx,args)=>{
 await member(ctx,args.teamId,true);const name=args.name.trim();if(!name||name.length>60)throw Error('Use a team name between 1 and 60 characters');await ctx.db.patch(args.teamId,{name});
}});
export const moveBoard=mutation({args:{boardId:v.id('boards'),teamId:v.union(v.id('teams'),v.null())},handler:async(ctx,args)=>{
 const {membership}=await access(ctx,'',args.boardId);if(membership.role!=='owner')throw Error('Only the board owner can move it');if(args.teamId)await member(ctx,args.teamId);await ctx.db.patch(args.boardId,{teamId:args.teamId||undefined,updatedAt:Date.now()});
}});

export const setResponsibility=mutation({args:{memberId:v.id('teamMembers'),responsibility:v.string()},handler:async(ctx,args)=>{
 const row=await ctx.db.get(args.memberId);if(!row)throw Error('Member not found');const {team,userId}=await member(ctx,row.teamId);
 if(userId!==row.userId&&userId!==team.ownerId)throw Error('Only you or the team owner can edit your role');
 if(args.responsibility.length>1000)throw Error('Keep responsibilities under 1,000 characters');
 await ctx.db.patch(row._id,{responsibility:args.responsibility.trim()});
}});

export const update=mutation({args:{teamId:v.id('teams'),name:v.string(),description:v.string()},handler:async(ctx,args)=>{
 await member(ctx,args.teamId,true);
 const name=args.name.trim(),description=args.description.trim();
 if(!name||name.length>60)throw Error('Use a workspace name between 1 and 60 characters');
 if(description.length>1000)throw Error('Keep the description under 1,000 characters');
 await ctx.db.patch(args.teamId,{name,description});
}});
export const remove=mutation({args:{teamId:v.id('teams'),confirmation:v.string()},handler:async(ctx,args)=>{
 const {team}=await member(ctx,args.teamId,true);
 if(args.confirmation!==team.name)throw Error('Type the workspace name to confirm deletion');
 // Preserve individually owned boards and their explicit grants. Team access ends atomically.
 const boards=await ctx.db.query('boards').withIndex('team',q=>q.eq('teamId',args.teamId)).collect();
 for(const board of boards)await ctx.db.patch(board._id,{teamId:undefined,updatedAt:Date.now()});
 for(const row of await ctx.db.query('teamMembers').withIndex('team_user',q=>q.eq('teamId',args.teamId)).collect())await ctx.db.delete(row._id);
 for(const row of await ctx.db.query('teamInvites').withIndex('team',q=>q.eq('teamId',args.teamId)).collect())await ctx.db.delete(row._id);
 await ctx.db.delete(args.teamId);
}});
export const leave=mutation({args:{teamId:v.id('teams')},handler:async(ctx,args)=>{
 const {team,userId,membership}=await member(ctx,args.teamId);
 if(team.ownerId===userId)throw Error('The owner cannot leave their workspace');
 await ctx.db.delete(membership._id);
}});
