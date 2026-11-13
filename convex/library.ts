import { query, mutation } from './_generated/server';
import { v } from 'convex/values';
import { getAuthUserId } from '@convex-dev/auth/server';
import { access, requireDevelopmentSecret } from './access';
import { loadDocument } from './documents';

export const list = query({args:{},handler:async ctx=>{
  const userId=await getAuthUserId(ctx);if(!userId)return [];
  const direct=await ctx.db.query('boardMembers').withIndex('user',q=>q.eq('userId',userId)).collect();
  const linked=await ctx.db.query('linkMembers').withIndex('user',q=>q.eq('userId',userId)).collect();
  const memberships=await ctx.db.query('teamMembers').withIndex('user',q=>q.eq('userId',userId)).collect();
  const teamBoards=(await Promise.all(memberships.map(m=>ctx.db.query('boards').withIndex('team',q=>q.eq('teamId',m.teamId)).collect()))).flat();
  const ids=[...new Set([...direct,...linked].map(m=>m.boardId).concat(teamBoards.map(b=>b._id)))];const result=[];
  for(const boardId of ids){let permission;try{permission=await access(ctx,'',boardId);}catch{continue;}
    const {board,membership}=permission;
    const nodes=await ctx.db.query('nodes').withIndex('board_key',q=>q.eq('boardId',boardId)).collect();
    const live=nodes.filter(n=>!n.deleted);
    const preview=await Promise.all(live.map(async n=>{
      const doc=loadDocument(n.textState),d=n.data;const title=doc.getText('title').toString(),body=doc.getText('body').toString().slice(0,1400),draft=doc.getText('draft').toString().slice(0,200);doc.destroy();
      const messages=(d.messages||[]).slice(-2).map((m:any)=>({role:m.role,text:String(m.text||m.content||'').slice(0,600)}));
      const image=d.mediaType==='video'&&d.videoId?`https://i.ytimg.com/vi/${encodeURIComponent(d.videoId)}/hqdefault.jpg`:d.storageId&&String(d.mime||'').startsWith('image/')?await ctx.storage.getUrl(d.storageId):d.image||null;
      return {key:n.key,type:d.type,x:d.x||0,y:d.y||0,width:d.width||(d.type==='thread'?520:d.type==='web'?540:380),minHeight:d.minHeight||0,title,body,draft,messages,image,mediaType:d.mediaType||null,url:d.url||'',connections:(d.contexts||[]).map((c:any)=>c.source)};
    }));
    result.push({id:boardId,teamId:board.teamId||null,teamName:board.teamId?(await ctx.db.get(board.teamId))?.name:null,title:board.title,role:membership.role,owned:board.ownerId===userId,updatedAt:board.updatedAt||board._creationTime,count:live.length,preview,ownerName:(await ctx.db.get(board.ownerId))?.name||'Board owner'});
  }
  return result.sort((a,b)=>b.updatedAt-a.updatedAt);
}});
export const permission=query({args:{boardId:v.id('boards'),token:v.string()},handler:async(ctx,args)=>{
  try{const {board,membership}=await access(ctx,args.token,args.boardId);return {title:board.title,role:membership.role};}catch{return null;}
}});
export const create = mutation({args:{title:v.string(),teamId:v.optional(v.id('teams'))},handler:async(ctx,args)=>{
  const userId=await getAuthUserId(ctx);if(!userId)throw Error('Sign in to create a board');
  if(args.teamId){const member=await ctx.db.query('teamMembers').withIndex('team_user',q=>q.eq('teamId',args.teamId!).eq('userId',userId)).unique();if(!member)throw Error('Join this team before creating a board');}
  const title=args.title.trim().slice(0,120)||'Untitled board';
  const boardId=await ctx.db.insert('boards',{title,ownerId:userId,teamId:args.teamId,development:false,initialized:true,updatedAt:Date.now()});
  await ctx.db.insert('boardMembers',{boardId,userId,role:'owner'});return boardId;
}});
export const rename = mutation({args:{boardId:v.id('boards'),title:v.string()},handler:async(ctx,args)=>{
  await access(ctx,'',args.boardId,true);const title=args.title.trim();if(!title||title.length>120)throw Error('Use a name between 1 and 120 characters');
  await ctx.db.patch(args.boardId,{title,updatedAt:Date.now()});
}});
export const archive = mutation({args:{boardId:v.id('boards')},handler:async(ctx,args)=>{
  const {membership}=await access(ctx,'',args.boardId);if(membership.role!=='owner')throw Error('Only the owner can archive this board');
  await ctx.db.patch(args.boardId,{archived:true});
}});
export const claimInfo = query({args:{secret:v.string(),identityKey:v.string()},handler:async(ctx,args)=>{
  requireDevelopmentSecret(args.secret);const user=await ctx.db.query('users').withIndex('identity',q=>q.eq('identityKey',args.identityKey)).unique();if(!user)return [];
  return (await ctx.db.query('boards').withIndex('owner',q=>q.eq('ownerId',user._id)).collect()).filter(b=>b.development).map(b=>({id:b._id,title:b.title}));
}});
export const claim = mutation({args:{secret:v.string(),identityKey:v.string()},handler:async(ctx,args)=>{
  requireDevelopmentSecret(args.secret);const accountId=await getAuthUserId(ctx);if(!accountId)throw Error('Sign in first');
  const old=await ctx.db.query('users').withIndex('identity',q=>q.eq('identityKey',args.identityKey)).unique();if(!old)return [];
  const boards=(await ctx.db.query('boards').withIndex('owner',q=>q.eq('ownerId',old._id)).collect()).filter(b=>b.development);
  for(const board of boards){
    for(const member of await ctx.db.query('boardMembers').withIndex('board_user',q=>q.eq('boardId',board._id)).collect())await ctx.db.delete(member._id);
    await ctx.db.patch(board._id,{ownerId:accountId,development:false,updatedAt:Date.now()});
    await ctx.db.insert('boardMembers',{boardId:board._id,userId:accountId,role:'owner'});
  }
  return boards.map(b=>b._id);
}});
