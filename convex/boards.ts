import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { access, requireDevelopmentSecret, tokenHash } from './access';
import { initialDocument, loadDocument, readText } from './documents';

export const developmentSession = mutation({
  args: { secret: v.string(), identityKey: v.string(), token: v.string(), boardId: v.optional(v.id('boards')) },
  handler: async (ctx, args) => {
    requireDevelopmentSecret(args.secret);
    if(process.env.ENABLE_DEVELOPMENT_BRIDGE!=='true')throw Error('Development login is disabled. Sign in with an account.');
    let user = await ctx.db.query('users').withIndex('identity', q => q.eq('identityKey', args.identityKey)).unique();
    if (!user) {
      const id = await ctx.db.insert('users', { identityKey: args.identityKey, name: 'Collaborator ' + args.identityKey.slice(0, 4), kind: 'development' });
      user = (await ctx.db.get(id))!;
    }
    let board = args.boardId ? await ctx.db.get(args.boardId) : null;
    if (args.boardId && (!board || !board.development)) throw Error('Not a development board');
    if (!board) {
      // A single initial development board. Explicit IDs allow additional boards later.
      board = await ctx.db.query('boards').filter(q => q.eq(q.field('development'), true)).first();
      if (!board) board = await ctx.db.get(await ctx.db.insert('boards', { title: 'Product workspace', ownerId: user._id, development: true, initialized: false }));
    }
    const boardId = board!._id;
    const member = await ctx.db.query('boardMembers').withIndex('board_user', q => q.eq('boardId', boardId).eq('userId', user!._id)).unique();
    if (!member) await ctx.db.insert('boardMembers', { boardId, userId: user._id, role: board!.ownerId === user._id ? 'owner' : 'editor' });
    const hash = await tokenHash(args.token);
    const existing = await ctx.db.query('sessions').withIndex('token', q => q.eq('tokenHash', hash)).unique();
    if (existing) await ctx.db.patch(existing._id, { expiresAt: Date.now() + 86400000 });
    else await ctx.db.insert('sessions', { tokenHash: hash, userId: user._id, expiresAt: Date.now() + 86400000 });
    return { boardId, userId: user._id, name: user.name, initialized: board!.initialized };
  },
});

export const initialize = mutation({
  args: { token: v.string(), boardId: v.id('boards'), title: v.string(), nodes: v.array(v.any()) },
  handler: async (ctx, args) => {
    const { board, userId } = await access(ctx, args.token, args.boardId, true);
    if (board.initialized) return;
    if (board.ownerId !== userId) throw Error('The owner must initialize this board');
    if (args.nodes.length > 300) throw Error('Import up to 300 nodes at once');
    const keys = new Set();
    for (const node of args.nodes) {
      if (typeof node.id !== 'string' || keys.has(node.id)) throw Error('Invalid node ID');
      keys.add(node.id);
      await ctx.db.insert('nodes', { boardId: args.boardId, key: node.id, data: node, textState: initialDocument(node), textVersion: 0, createdBy: userId, updatedBy: userId, deleted: false });
    }
    await ctx.db.patch(args.boardId, { initialized: true, title: args.title.slice(0, 200) });
  },
});

export const read = query({
  args: { token: v.string(), boardId: v.id('boards') },
  handler: async (ctx, args) => {
    const { board, membership } = await access(ctx, args.token, args.boardId);
    const nodes = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', args.boardId)).collect();
    return { title: board.title, role:membership.role, nodes: await Promise.all(nodes.filter(n => !n.deleted).map(async n => {
      const doc = loadDocument(n.textState); const text = readText(doc); doc.destroy();
      const author=await ctx.db.get(n.updatedBy);
      const messages=await Promise.all((n.data.messages||[]).map(async(m:any)=>{const personId=typeof m.sentBy==='string'?ctx.db.normalizeId('users',m.sentBy):null;const person=personId?await ctx.db.get(personId):null;return {...m,...(person?{person:{name:person.name,color:person.color||'#6685cf'}}:{})};}));
      return { ...n.data, ...text, messages, authorProfile:author?{name:author.name,color:author.color||'#6685cf'}:null, id: n.key, sharedVersion: n.textVersion, sharedTextState: n.textState };
    })) };
  },
});

const editableFields = new Set(['x','y','width','minHeight','collapsed','contexts','revision','author','titleEdited','titleGenerated','mediaType','source','videoId','image','credit','license','licenseURL','url','asset','storageId','mime','size','text','transcript','transcriptLanguage','contextFor','bottomPorts','modelStage','modelBalance','query','searchMode','mediaResults','resultMode','nextPage','creditOpen','agent','agentName','autoGroup','layoutHeight']);
// Deletion and restoration operate on current rows, never a client board snapshot.
export const deleteNode = mutation({
  args: { token: v.string(), boardId: v.id('boards'), nodeKey: v.string(), operationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await access(ctx, args.token, args.boardId, true);
    const nodes = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', args.boardId)).collect();
    const node = nodes.find(n => n.key === args.nodeKey);
    if (!node || node.deleted) throw Error('This card has already been removed');
    const connections = [];
    for (const target of nodes) {
      if (target.deleted || target.key === node.key) continue;
      const contexts = target.data.contexts || [];
      const removed = contexts.flatMap((context: any, index: number) => context.source === node.key ? [{ context, index }] : []);
      if (!removed.length) continue;
      connections.push({ target: target.key, entries: removed });
      await ctx.db.patch(target._id, { data: { ...target.data, contexts: contexts.filter((c: any) => c.source !== node.key) } });
    }
    // Stop research atomically with deletion; undo must not revive a cancelled run.
    const data = { ...node.data };
    if (data.agent && data.activeRun) {
      const run = await ctx.db.get(data.activeRun);
      if (run) await ctx.db.patch(run._id, { status: 'cancelled' });
      delete data.activeRun;
      delete data.activity;
      data.agentStage = 'Stopped';
    }
    await ctx.db.patch(node._id, { data, deleted: true, updatedBy: userId, deletion: { operationId: args.operationId, userId, connections } });
    await ctx.db.patch(args.boardId, { updatedAt: Date.now() });
  },
});

export const restoreNode = mutation({
  args: { token: v.string(), boardId: v.id('boards'), nodeKey: v.string(), operationId: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await access(ctx, args.token, args.boardId, true);
    const nodes = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', args.boardId)).collect();
    const node = nodes.find(n => n.key === args.nodeKey);
    if (!node?.deleted || node.deletion?.operationId !== args.operationId || node.deletion.userId !== userId) throw Error('This deletion can no longer be undone');
    for (const connection of node.deletion.connections) {
      const target = nodes.find(n => n.key === connection.target);
      if (!target || target.deleted) continue;
      const contexts = [...(target.data.contexts || [])];
      for (const { context, index } of connection.entries) {
        if (!contexts.some((c: any) => context.id ? c.id === context.id : JSON.stringify(c) === JSON.stringify(context))) contexts.splice(Math.min(index, contexts.length), 0, context);
      }
      await ctx.db.patch(target._id, { data: { ...target.data, contexts } });
    }
    await ctx.db.patch(node._id, { deleted: false, updatedBy: userId, deletion: undefined });
    await ctx.db.patch(args.boardId, { updatedAt: Date.now() });
  },
});

export const patchNodes = mutation({
  args: { token: v.string(), boardId: v.id('boards'), changes: v.array(v.any()), title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await access(ctx, args.token, args.boardId, true);
    if (args.changes.length > 300) throw Error('Too many changes');
    for (const change of args.changes) {
      const node = await ctx.db.query('nodes').withIndex('board_key', q => q.eq('boardId', args.boardId).eq('key', change.id)).unique();
      if (change.create && !node) {
        const data = change.create;
        if (!['plan','thread','web','upload','media','search'].includes(data.type)) throw Error('Invalid node type');
        await ctx.db.insert('nodes', { boardId: args.boardId, key: change.id, data: { ...data, id: change.id, messages: data.messages || [] }, textState: initialDocument(data), textVersion: 0, createdBy: userId, updatedBy: userId, deleted: false });
      } else if (node && !node.deleted) {
        if (change.remove) { await ctx.db.patch(node._id, { deleted: true, updatedBy: userId }); continue; }
        const patch: Record<string, any> = {};
        // GitHub card content comes only from the server's fetch, never from a client.
        const locked = node.data.type === 'github' ? new Set(['text', 'github', 'revision']) : null;
        for (const [key, value] of Object.entries(change.patch || {})) if (editableFields.has(key) && !locked?.has(key)) patch[key] = value;
        await ctx.db.patch(node._id, { data: { ...node.data, ...patch }, updatedBy: userId });
      }
    }
    await ctx.db.patch(args.boardId, {updatedAt:Date.now(),...(args.title !== undefined?{title: args.title.slice(0, 200)}:{})});
  },
});
