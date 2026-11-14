import {query} from './_generated/server';
import {v} from 'convex/values';
import {getAuthUserId} from '@convex-dev/auth/server';
import {components} from './_generated/api';
import {access} from './access';

// Username storage belongs to the auth component. Resolve there so existing
// accounts work immediately, without a second, potentially stale directory.
export const suggestions=query({args:{prefix:v.string(),boardId:v.optional(v.id('boards')),teamId:v.optional(v.id('teams'))},handler:async(ctx,args)=>{
 const userId=await getAuthUserId(ctx);if(!userId)throw Error('Sign in first');
 const excluded=new Set<string>([userId]);
 if(Boolean(args.boardId)===Boolean(args.teamId))throw Error('Choose a board or workspace');
 if(args.boardId){
  const {board,membership}=await access(ctx,'',args.boardId);if(membership.role!=='owner')throw Error('Only the owner can invite people');
  for(const row of await ctx.db.query('boardMembers').withIndex('board_user',q=>q.eq('boardId',args.boardId!)).collect())excluded.add(row.userId);
  if(board.teamId)for(const row of await ctx.db.query('teamMembers').withIndex('team_user',q=>q.eq('teamId',board.teamId!)).collect())excluded.add(row.userId);
 }else{
  const team=await ctx.db.get(args.teamId!);if(!team||team.ownerId!==userId)throw Error('Only the owner can invite people');
  for(const row of await ctx.db.query('teamMembers').withIndex('team_user',q=>q.eq('teamId',args.teamId!)).collect())excluded.add(row.userId);
 }
 const prefix=args.prefix.trim().replace(/^@/,'').normalize('NFKC').toLowerCase();
 if(prefix.length<2||prefix.length>64)return [];
 const matches=[];
 for await(const user of ctx.db.query('users')){
  if(user.kind!=='account'||excluded.has(user._id))continue;
  const username=await ctx.runQuery(components.authUsername.public.getUsername,{userId:user._id});
  if(username?.normalize('NFKC').toLowerCase().startsWith(prefix))matches.push({userId:user._id,username,name:user.name||username,color:user.color||'#6685cf'});
 }
 return matches.sort((a,b)=>a.username.localeCompare(b.username)).slice(0,6);
}});
