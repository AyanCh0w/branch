import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import * as Y from 'yjs';
import { access, accessForUser } from './access';
import { loadDocument, encodeDocument, withText, patchNode, textRow } from './documents';

export const LEASE_MS = 20000;
export const PRESENCE_MS = 30000;
// Per-request caches: one access check and one profile read per person, not per row.
function people(ctx: any, boardId: any) {
  const access = new Map<string, Promise<boolean>>(), profiles = new Map<string, Promise<any>>();
  return {
    allowed: (userId: any) => { if (!access.has(userId)) access.set(userId, accessForUser(ctx, userId, boardId).then(() => true, () => false)); return access.get(userId)!; },
    profile: (userId: any) => { if (!profiles.has(userId)) profiles.set(userId, ctx.db.get(userId)); return profiles.get(userId)!; },
  };
}
export const editors = query({
  args: { token: v.string(), boardId: v.id('boards') },
  handler: async (ctx, args) => {
    await access(ctx, args.token, args.boardId);
    const rows = await ctx.db.query('editors').withIndex('board', q => q.eq('boardId', args.boardId)).collect();
    const who = people(ctx, args.boardId);
    return Promise.all(rows.map(async row => { const user = await who.profile(row.userId); return { ...row, name: user?.name || 'Collaborator', color: user?.color || '#6685cf' }; }));
  },
});
export const focus = mutation({
  args: { token: v.string(), boardId: v.id('boards'), nodeKey: v.string(), field: v.string(), tabId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await access(ctx, args.token, args.boardId, true);
    if (!['body','draft','title'].includes(args.field)) throw Error('Invalid editor');
    const node = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', args.boardId).eq('key', args.nodeKey)).unique();
    if (!node) throw Error('Node not found');
    // Deletion wins over editor activity already in flight from another tab.
    if (node.deleted) return { deleted: true, expiresAt: 0, epoch: node.data.draftEpoch || 0 };
    const rows = await ctx.db.query('editors').withIndex('board', q => q.eq('boardId', args.boardId)).collect();
    for (const row of rows) if (row.tabId === args.tabId && row.userId === userId && row.nodeKey === args.nodeKey && row.field === args.field) await ctx.db.delete(row._id);
    const expiresAt = Date.now() + LEASE_MS;
    await ctx.db.insert('editors', { boardId: args.boardId, nodeKey: args.nodeKey, field: args.field, tabId: args.tabId, userId, expiresAt });
    return { expiresAt, epoch: node.data.draftEpoch || 0 };
  },
});
export const release = mutation({
  args: { token: v.string(), boardId: v.id('boards'), tabId: v.string(), nodeKey: v.optional(v.string()), field: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await access(ctx, args.token, args.boardId, true);
    for (const row of await ctx.db.query('editors').withIndex('board', q => q.eq('boardId', args.boardId)).collect()) {
      if (row.tabId === args.tabId && row.userId === userId && (!args.nodeKey || row.nodeKey === args.nodeKey) && (!args.field || row.field === args.field)) await ctx.db.delete(row._id);
    }
  },
});
// One card's live text. Each card has its own subscription, so a keystroke
// sends only that card's text to the people viewing the board.
export const text = query({
  args: { token: v.string(), boardId: v.id('boards'), nodeKey: v.string() },
  handler: async (ctx, args) => {
    await access(ctx, args.token, args.boardId);
    const row = await textRow(ctx, args.boardId, args.nodeKey);
    if (row) return { textState: row.textState, version: row.textVersion };
    const node = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', args.boardId).eq('key', args.nodeKey)).unique();
    return node && !node.deleted ? { textState: node.textState, version: node.textVersion } : null;
  },
});
export const updateText = mutation({
  args: { token: v.string(), boardId: v.id('boards'), nodeKey: v.string(), update: v.bytes(), tabId: v.string(), epoch: v.number() },
  handler: async (ctx, args) => {
    const { userId } = await access(ctx, args.token, args.boardId, true);
    if (args.update.byteLength > 500000) throw Error('Text update too large');
    const raw = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', args.boardId).eq('key', args.nodeKey)).unique();
    if (!raw) throw Error('Node not found');
    const node = await withText(ctx, raw);
    // A late edit must neither revive the tombstone nor pause the whole board.
    if (node.deleted) return { deleted: true, version: node.textVersion };
    const doc = loadDocument(node.textState);
    const oldDraft = doc.getText('draft').toString();
    Y.applyUpdate(doc, new Uint8Array(args.update));
    if (oldDraft !== doc.getText('draft').toString()) {
      const rows = await ctx.db.query('editors').withIndex('node', q => q.eq('boardId', args.boardId).eq('nodeKey', args.nodeKey)).collect();
      if (!rows.some(r => r.userId === userId && r.tabId === args.tabId && r.field === 'draft' && r.expiresAt > Date.now())) throw Error('Editing session expired. Your draft has been kept locally.');
      if (args.epoch !== (node.data.draftEpoch || 0)) throw Error('This prompt was already sent. Your edits have been kept locally.');
    }
    for (const field of ['body','title','draft']) if (doc.getText(field).length > 150000) throw Error('Text is too long');
    const version = node.textVersion + 1;
    // Only touch the node record when the last editor changes; text goes to its own table.
    await patchNode(ctx, node, { textState: encodeDocument(doc), textVersion: version, ...(node.updatedBy !== userId ? { updatedBy: userId } : {}) });
    doc.destroy();
    return { version };
  },
});

// Cursor presence is separate from editing leases: viewers can point without locking Send.
export const cursors = query({
  args: { token:v.string(), boardId:v.id('boards') },
  handler: async(ctx,args)=>{
    const {userId}=await access(ctx,args.token,args.boardId);
    const rows=await ctx.db.query('cursors').withIndex('board',q=>q.eq('boardId',args.boardId)).collect();
    const result=[];const who=people(ctx,args.boardId);
    for(const row of rows){
      if(row.userId===userId||row.expiresAt<=Date.now())continue;
      if(!await who.allowed(row.userId))continue;
      const user=await who.profile(row.userId);
      result.push({tabId:row.tabId,userId:row.userId,x:row.x,y:row.y,expiresAt:row.expiresAt,name:user?.name||'Collaborator',color:user?.color||'#6685cf'});
    }
    return result;
  },
});
export const point = mutation({
  args:{token:v.string(),boardId:v.id('boards'),tabId:v.string(),position:v.union(v.null(),v.object({x:v.number(),y:v.number()}))},
  handler:async(ctx,args)=>{
    const {userId}=await access(ctx,args.token,args.boardId);
    if(!args.tabId||args.tabId.length>100)throw Error('Invalid cursor session');
    if(args.position&&(!Number.isFinite(args.position.x)||!Number.isFinite(args.position.y)||Math.abs(args.position.x)>1e7||Math.abs(args.position.y)>1e7))throw Error('Invalid cursor position');
    const current=(await ctx.db.query('cursors').withIndex('board_tab',q=>q.eq('boardId',args.boardId).eq('tabId',args.tabId)).collect()).find(row=>row.userId===userId);
    if(!args.position){if(current)await ctx.db.delete(current._id);return;}
    const patch={...args.position,expiresAt:Date.now()+15000};
    if(current){await ctx.db.patch(current._id,patch);return;}
    // Clean up abandoned cursors only when a new one appears, not on every move.
    for(const row of await ctx.db.query('cursors').withIndex('board',q=>q.eq('boardId',args.boardId)).collect())if(row.expiresAt<=Date.now())await ctx.db.delete(row._id);
    await ctx.db.insert('cursors',{boardId:args.boardId,userId,tabId:args.tabId,...patch});
  },
});

// Board attendance is independent of pointer position and editing leases.
export const activeUsers = query({
  args:{token:v.string(),boardId:v.id('boards')},
  handler:async(ctx,args)=>{
    await access(ctx,args.token,args.boardId);
    const rows=await ctx.db.query('boardPresence').withIndex('board',q=>q.eq('boardId',args.boardId)).collect();
    const who=people(ctx,args.boardId);
    const present=new Map<string,{userId:string,name:string,color:string,expiresAt:number}>();
    for(const row of rows){
      if(row.expiresAt<=Date.now())continue;
      if(!await who.allowed(row.userId))continue;
      const user=await who.profile(row.userId);
      if(!user)continue;
      const previous=present.get(row.userId);
      if(!previous||previous.expiresAt<row.expiresAt)present.set(row.userId,{userId:row.userId,name:user.name,color:user.color||'#6685cf',expiresAt:row.expiresAt});
    }
    return [...present.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.userId.localeCompare(b.userId));
  },
});
export const attend = mutation({
  args:{token:v.string(),boardId:v.id('boards'),tabId:v.string(),active:v.boolean()},
  handler:async(ctx,args)=>{
    const {userId}=await access(ctx,args.token,args.boardId);
    if(!args.tabId||args.tabId.length>100)throw Error('Invalid presence session');
    const current=(await ctx.db.query('boardPresence').withIndex('board_tab',q=>q.eq('boardId',args.boardId).eq('tabId',args.tabId)).collect()).find(row=>row.userId===userId);
    if(!args.active){if(current)await ctx.db.delete(current._id);return;}
    const expiresAt=Date.now()+PRESENCE_MS;
    if(current){await ctx.db.patch(current._id,{expiresAt});return;}
    for(const row of await ctx.db.query('boardPresence').withIndex('board',q=>q.eq('boardId',args.boardId)).collect())if(row.expiresAt<=Date.now())await ctx.db.delete(row._id);
    await ctx.db.insert('boardPresence',{boardId:args.boardId,userId,tabId:args.tabId,expiresAt});
  },
});
