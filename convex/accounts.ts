import { internalMutation, query, mutation } from './_generated/server';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import { components } from './_generated/api';

export const createUser = internalMutation({
  args: { method: v.object({ name: v.literal('usernamePassword'), profile: v.object({}) }) },
  returns: v.id('users'),
  handler: async ctx => ctx.db.insert('users', { name: '', kind: 'account' }),
});
export const me = query({ args: {}, handler: async ctx => {
  const id=await getAuthUserId(ctx); if(!id)return null;
  const user=await ctx.db.get(id); if(!user)return null;
  const username=await ctx.runQuery(components.authUsername.public.getUsername,{userId:id});
  return {id,name:user.name||username||'Member',username,color:user.color||'#6685cf',background:user.background||''};
}});
export const setName = mutation({args:{name:v.string()},handler:async(ctx,args)=>{
  const id=await getAuthUserId(ctx);if(!id)throw Error('Sign in first');
  const name=args.name.trim();if(!name||name.length>60)throw Error('Use a name between 1 and 60 characters');
  await ctx.db.patch(id,{name});
}});

export const updateProfile = mutation({args:{name:v.string(),color:v.string(),background:v.string()},handler:async(ctx,args)=>{
 const id=await getAuthUserId(ctx);if(!id)throw Error('Sign in first');
 const name=args.name.trim(),background=args.background.trim();
 if(!name||name.length>60)throw Error('Use a name between 1 and 60 characters');
 if(!/^#[0-9a-f]{6}$/i.test(args.color))throw Error('Choose a valid color');
 if(background.length>4000)throw Error('Keep your background under 4,000 characters');
 await ctx.db.patch(id,{name,color:args.color,background});
}});
