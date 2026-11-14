import { defineSchema, defineTable } from './definitions';
import { v } from './validation';

export default defineSchema({
  uploadTickets:defineTable({fileTicket:v.id('fileUploads'),boardId:v.id('boards'),userId:v.id('users'),hash:v.string(),expiresAt:v.number(),used:v.boolean()}),
  chatgptConnections: defineTable({userId:v.id('users'),ciphertext:v.string(),subject:v.string(),clientId:v.string(),label:v.string(),models:v.array(v.object({slug:v.string(),name:v.string()})),selectedModel:v.string(),expiresAt:v.number(),revision:v.number(),refreshLease:v.optional(v.string()),refreshUntil:v.optional(v.number())}).index('user',['userId']),
  chatgptTransactions: defineTable({userId:v.id('users'),consumed:v.optional(v.boolean()),stateHash:v.string(),browserHash:v.string(),ciphertext:v.string(),expiresAt:v.number(),connectionId:v.optional(v.id('chatgptConnections'))}).index('state',['stateHash']).index('user',['userId']),
  workspaceKeys: defineTable({scope:v.string(),ciphertext:v.string(),suffix:v.string()}).index('scope',['scope']),
  fileUploads: defineTable({boardId:v.id('boards'),userId:v.id('users'),storageId:v.optional(v.id('_storage'))}).index('storage',['storageId']),
  users: defineTable({ identityKey: v.optional(v.string()), name: v.string(), color: v.optional(v.string()), background: v.optional(v.string()), kind: v.union(v.literal('development'), v.literal('account'), v.literal('guest')) }).index('identity', ['identityKey']),
  teams: defineTable({ name: v.string(), description: v.optional(v.string()), ownerId: v.id('users') }),
  teamMembers: defineTable({ teamId: v.id('teams'), userId: v.id('users'), role: v.string(), responsibility: v.optional(v.string()) }).index('team_user', ['teamId', 'userId']).index('user',['userId']),
  teamInvites: defineTable({ teamId: v.id('teams'), tokenHash: v.string(), invitedBy: v.id('users'), role: v.string(), expiresAt: v.number(), acceptedBy: v.optional(v.id('users')) }).index('token', ['tokenHash']).index('team',['teamId']),
  boards: defineTable({ projectPlan: v.optional(v.any()), projectVersion: v.optional(v.number()), repository: v.optional(v.string()), title: v.string(), ownerId: v.id('users'), teamId: v.optional(v.id('teams')), development: v.boolean(), initialized: v.boolean(), updatedAt: v.optional(v.number()), archived: v.optional(v.boolean()) }).index('owner',['ownerId']).index('team',['teamId']),
  boardMembers: defineTable({ boardId: v.id('boards'), userId: v.id('users'), role: v.union(v.literal('owner'), v.literal('editor'), v.literal('viewer')), responsibility: v.optional(v.string()) }).index('board_user', ['boardId', 'userId']).index('user',['userId']),
  projectResponsibilities: defineTable({boardId:v.id('boards'),userId:v.id('users'),responsibility:v.string()}).index('board_user',['boardId','userId']),
  sessions: defineTable({ tokenHash: v.string(), userId: v.id('users'), expiresAt: v.number() }).index('token', ['tokenHash']),
  nodes: defineTable({ boardId: v.id('boards'), key: v.string(), data: v.any(), textState: v.bytes(), textVersion: v.number(), createdBy: v.id('users'), updatedBy: v.id('users'), deleted: v.boolean(), deletion: v.optional(v.object({ operationId: v.string(), userId: v.id('users'), connections: v.array(v.any()) })) }).index('board_key', ['boardId', 'key']),
  boardPresence: defineTable({boardId:v.id('boards'),userId:v.id('users'),tabId:v.string(),expiresAt:v.number()}).index('board',['boardId']),
  cursors: defineTable({boardId:v.id('boards'),userId:v.id('users'),tabId:v.string(),x:v.number(),y:v.number(),expiresAt:v.number()}).index('board',['boardId']),
  editors: defineTable({ boardId: v.id('boards'), nodeKey: v.string(), field: v.string(), tabId: v.string(), userId: v.id('users'), expiresAt: v.number() }).index('board', ['boardId']).index('node', ['boardId', 'nodeKey']),
  runs: defineTable({ boardId: v.id('boards'), nodeKey: v.string(), status: v.union(v.literal('queued'), v.literal('streaming'), v.literal('complete'), v.literal('failed'), v.literal('cancelled')), initiatedBy: v.id('users'), billedUserId: v.id('users'), model: v.string(), provider:v.optional(v.union(v.literal('default'),v.literal('chatgpt'))), connectionId:v.optional(v.id('chatgptConnections')), providerUserId:v.optional(v.id('users')), requestId: v.string(), input: v.any(), assistantId: v.string(), checkpoint: v.optional(v.any()), error: v.optional(v.string()), usage: v.optional(v.any()), createdAt: v.number() }).index('request', ['boardId', 'requestId']).index('board', ['boardId']),
  // Reserved foundations: no public guest-link or billing endpoints yet.
  boardLinks: defineTable({ boardId: v.id('boards'), tokenHash: v.string(), role: v.union(v.literal('viewer'), v.literal('editor')), expiresAt: v.optional(v.number()), revoked: v.boolean(), label:v.optional(v.string()), lastGuestAt:v.optional(v.number()) }).index('token', ['tokenHash']).index('board',['boardId']),
  linkMembers: defineTable({boardId:v.id('boards'),linkId:v.id('boardLinks'),userId:v.id('users')}).index('board_user',['boardId','userId']).index('user',['userId']),
  creditLedger: defineTable({ ownerId: v.id('users'), boardId: v.id('boards'), runId: v.id('runs'), amount: v.number(), kind: v.string() }).index('owner', ['ownerId']),
});
