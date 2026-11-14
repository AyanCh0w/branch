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
import { resolveContext } from '../../app/context.js';
export function contextForChat(contexts: any[]) { return resolveContext(contexts); }
