'use node';
import {action,internalAction} from './_generated/server';
import {internal} from './_generated/api';
import {v} from 'convex/values';
export const save=action({args:{teamId:v.optional(v.id('teams')),key:v.union(v.string(),v.null())},handler:async(ctx,args)=>{
 await ctx.runQuery(internal.workspaceKeys.authorize,{teamId:args.teamId});
 if(args.key!==null)throw Error('Custom keys have been replaced by ChatGPT connections.');
 await ctx.runMutation(internal.workspaceKeys.store,{teamId:args.teamId,ciphertext:null,suffix:''});
}});
export const resolve=internalAction({args:{boardId:v.id('boards')},handler:async(ctx,args):Promise<string>=>{
 const key=process.env.OPENAI_API_KEY;if(!key)throw Error('Branch default AI is not configured.');return key;
}});
