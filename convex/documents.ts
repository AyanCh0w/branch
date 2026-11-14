import * as Y from 'yjs';

export const textFields = ['body', 'draft', 'title'] as const;
export function loadDocument(state?: ArrayBuffer) {
  const doc = new Y.Doc();
  if (state) Y.applyUpdate(doc, new Uint8Array(state));
  return doc;
}
export function encodeDocument(doc: Y.Doc): ArrayBuffer {
  return Uint8Array.from(Y.encodeStateAsUpdate(doc)).buffer;
}
export function readText(doc: Y.Doc) {
  return Object.fromEntries(textFields.map(field => [field, doc.getText(field).toString()]));
}
export function initialDocument(data: any) {
  const doc = new Y.Doc();
  for (const field of textFields) if (typeof data[field] === 'string') doc.getText(field).insert(0, data[field]);
  const state = encodeDocument(doc); doc.destroy(); return state;
}
// One resolver for local and shared sends: preserve distinct excerpts and frozen attachments.
import { resolveContext } from '../app/context.js';
export function contextForChat(contexts: any[]) { return resolveContext(contexts); }

// Live card text lives in its own table, so typing doesn't rewrite the card's
// main record and every board subscriber doesn't re-receive the whole board.
// Cards that were never edited still carry their initial text on the node.
import type { QueryCtx, MutationCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
export function textRow(ctx: QueryCtx, boardId: Doc<'nodes'>['boardId'], key: string) {
  return ctx.db.query('nodeTexts').withIndex('board_key', q => q.eq('boardId', boardId).eq('key', key)).unique();
}
export async function withText<T extends Doc<'nodes'>>(ctx: QueryCtx, node: T): Promise<T> {
  const row = await textRow(ctx, node.boardId, node.key);
  return row ? { ...node, textState: row.textState, textVersion: row.textVersion } : node;
}
export function withTexts<T extends Doc<'nodes'>>(ctx: QueryCtx, nodes: T[]) { return Promise.all(nodes.map(node => withText(ctx, node))); }
// Writes text fields to the text table and any other fields to the node.
export async function patchNode(ctx: MutationCtx, node: Doc<'nodes'>, fields: Partial<Doc<'nodes'>>) {
  const { textState, textVersion, ...rest } = fields;
  if (textState !== undefined) {
    const row = await textRow(ctx, node.boardId, node.key);
    const value = { textState, textVersion: textVersion ?? (row?.textVersion ?? node.textVersion) + 1 };
    if (row) await ctx.db.patch(row._id, value);
    else await ctx.db.insert('nodeTexts', { boardId: node.boardId, key: node.key, ...value });
  }
  if (Object.keys(rest).length) await ctx.db.patch(node._id, rest);
}
