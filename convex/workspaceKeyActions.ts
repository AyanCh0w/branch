'use node';
import {action,internalAction} from './_generated/server';
import {internal} from './_generated/api';
import {v} from 'convex/values';
import {encrypt,decrypt} from '../collaboration/workspace-key.cjs';
export const save=action({args:{teamId:v.optional(v.id('teams')),key:v.union(v.string(),v.null())},handler:async(ctx,args)=>{
 await ctx.runQuery(internal.workspaceKeys.authorize,{teamId:args.teamId});
 const key=args.key?.trim();
 if(args.key!==null&&(!key||!/^sk-[A-Za-z0-9_-]{16,}$/.test(key)||key.length>512))throw Error('Enter a valid OpenAI API key.');
 await ctx.runMutation(internal.workspaceKeys.store,{teamId:args.teamId,ciphertext:key?encrypt(key,process.env.WORKSPACE_KEY_ENCRYPTION_KEY):null,suffix:key?key.slice(-4):''});
}});
export const resolve=internalAction({args:{boardId:v.id('boards')},handler:async(ctx,args):Promise<string>=>{
 const encrypted=await ctx.runQuery(internal.workspaceKeys.forRun,args);
 const key=encrypted?decrypt(encrypted,process.env.WORKSPACE_KEY_ENCRYPTION_KEY):process.env.OPENAI_API_KEY;
 if(!key)throw Error('Add an OpenAI API key in workspace settings.');return key;
}});
