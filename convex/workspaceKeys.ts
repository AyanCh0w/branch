import {query,internalQuery,internalMutation} from './_generated/server';
import {v} from 'convex/values';
import {getAuthUserId} from '@convex-dev/auth/server';
import {access} from './access';
const scopeArgs={teamId:v.optional(v.id('teams'))};
async function scope(ctx:any,teamId:any,owner=false){
 const userId=await getAuthUserId(ctx);if(!userId)throw Error('Sign in first');
 if(!teamId)return {scope:'user:'+userId,canManage:true};
 const team=await ctx.db.get(teamId),member=await ctx.db.query('teamMembers').withIndex('team_user',(q:any)=>q.eq('teamId',teamId).eq('userId',userId)).unique();
 if(!team||!member)throw Error('Workspace access denied');
 if(owner&&team.ownerId!==userId)throw Error('Only the workspace owner can manage the API key');
 return {scope:'team:'+teamId,canManage:team.ownerId===userId};
}
async function row(ctx:any,key:string){return ctx.db.query('workspaceKeys').withIndex('scope',(q:any)=>q.eq('scope',key)).unique();}
export const status=query({args:scopeArgs,handler:async(ctx,args)=>{const s=await scope(ctx,args.teamId),key=await row(ctx,s.scope);return {canManage:s.canManage,configured:!!key,suffix:key?.suffix};}});
export const store=internalMutation({args:{...scopeArgs,ciphertext:v.union(v.string(),v.null()),suffix:v.string()},handler:async(ctx,args)=>{
 const s=await scope(ctx,args.teamId,true),existing=await row(ctx,s.scope);
 if(args.ciphertext===null){if(existing)await ctx.db.delete(existing._id);return;}
 const data={scope:s.scope,ciphertext:args.ciphertext,suffix:args.suffix};if(existing)await ctx.db.replace(existing._id,data);else await ctx.db.insert('workspaceKeys',data);
}});
export const authorize=internalQuery({args:scopeArgs,handler:async(ctx,args)=>scope(ctx,args.teamId,true)});
async function forBoard(ctx:any,boardId:any){const board=await ctx.db.get(boardId);if(!board)throw Error('Board not found');return (await row(ctx,board.teamId?'team:'+board.teamId:'user:'+board.ownerId))?.ciphertext||null;}
export const forRun=internalQuery({args:{boardId:v.id('boards')},handler:(ctx,args)=>forBoard(ctx,args.boardId)});
// The local provider proxy must supply both server credentials and editing access.
export const forServer=query({args:{boardId:v.id('boards'),token:v.string(),secret:v.string()},handler:async(ctx,args)=>{
 if(!process.env.WORKSPACE_KEY_ENCRYPTION_KEY||args.secret!==process.env.WORKSPACE_KEY_ENCRYPTION_KEY)throw Error('Server access denied');
 await access(ctx,args.token,args.boardId,true);return forBoard(ctx,args.boardId);
}});
