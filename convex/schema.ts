import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  codingConnections: defineTable({ boardId: v.id('boards'), userId: v.id('users'), keyHash: v.string() })
    .index('board_user', ['boardId', 'userId']).index('key', ['keyHash']),
  codingHandoffs: defineTable({
    boardId: v.id('boards'), userId: v.id('users'), nodeId: v.id('nodes'), nodeKey: v.string(), expiresAt: v.number(),
    content: v.object({
      title: v.string(), text: v.string(), fileOmitted: v.boolean(),
      sources: v.array(v.object({ title: v.string(), text: v.string(), quote: v.string(), fileOmitted: v.boolean() })),
    }),
    result: v.optional(v.string()),
  }).index('board_user', ['boardId', 'userId']).index('node_user', ['nodeId', 'userId']),
  workspaceKeys: defineTable({scope:v.string(),ciphertext:v.string(),suffix:v.string()}).index('scope',['scope']),
  fileUploads: defineTable({boardId:v.id('boards'),userId:v.id('users'),storageId:v.optional(v.id('_storage'))}).index('storage',['storageId']),
  users: defineTable({ identityKey: v.optional(v.string()), name: v.string(), color: v.optional(v.string()), background: v.optional(v.string()), kind: v.union(v.literal('development'), v.literal('account'), v.literal('guest')) }).index('identity', ['identityKey']),
  teams: defineTable({ name: v.string(), description: v.optional(v.string()), ownerId: v.id('users') }),
  teamMembers: defineTable({ teamId: v.id('teams'), userId: v.id('users'), role: v.string(), responsibility: v.optional(v.string()) }).index('team_user', ['teamId', 'userId']).index('user',['userId']),
  teamInvites: defineTable({ teamId: v.id('teams'), tokenHash: v.string(), invitedBy: v.id('users'), role: v.string(), expiresAt: v.number(), acceptedBy: v.optional(v.id('users')) }).index('token', ['tokenHash']).index('team',['teamId']),
  boards: defineTable({ title: v.string(), ownerId: v.id('users'), teamId: v.optional(v.id('teams')), development: v.boolean(), initialized: v.boolean(), updatedAt: v.optional(v.number()), archived: v.optional(v.boolean()) }).index('owner',['ownerId']).index('team',['teamId']),
  boardMembers: defineTable({ boardId: v.id('boards'), userId: v.id('users'), role: v.union(v.literal('owner'), v.literal('editor'), v.literal('viewer')), responsibility: v.optional(v.string()) }).index('board_user', ['boardId', 'userId']).index('user',['userId']),
  projectResponsibilities: defineTable({boardId:v.id('boards'),userId:v.id('users'),responsibility:v.string()}).index('board_user',['boardId','userId']),
  sessions: defineTable({ tokenHash: v.string(), userId: v.id('users'), expiresAt: v.number() }).index('token', ['tokenHash']),
  nodes: defineTable({ boardId: v.id('boards'), key: v.string(), data: v.any(), textState: v.bytes(), textVersion: v.number(), createdBy: v.id('users'), updatedBy: v.id('users'), deleted: v.boolean(), codingResult: v.optional(v.object({ handoffId: v.id('codingHandoffs'), text: v.string() })), deletion: v.optional(v.object({ operationId: v.string(), userId: v.id('users'), connections: v.array(v.any()) })) }).index('board_key', ['boardId', 'key']),
  boardPresence: defineTable({boardId:v.id('boards'),userId:v.id('users'),tabId:v.string(),expiresAt:v.number()}).index('board',['boardId']),
  cursors: defineTable({boardId:v.id('boards'),userId:v.id('users'),tabId:v.string(),x:v.number(),y:v.number(),expiresAt:v.number()}).index('board',['boardId']),
  editors: defineTable({ boardId: v.id('boards'), nodeKey: v.string(), field: v.string(), tabId: v.string(), userId: v.id('users'), expiresAt: v.number() }).index('board', ['boardId']).index('node', ['boardId', 'nodeKey']),
  runs: defineTable({ boardId: v.id('boards'), nodeKey: v.string(), status: v.union(v.literal('queued'), v.literal('streaming'), v.literal('complete'), v.literal('failed'), v.literal('cancelled')), initiatedBy: v.id('users'), billedUserId: v.id('users'), model: v.literal('gpt-5.4-mini'), requestId: v.string(), input: v.any(), assistantId: v.string(), checkpoint: v.optional(v.any()), error: v.optional(v.string()), usage: v.optional(v.any()), createdAt: v.number() }).index('request', ['boardId', 'requestId']).index('board', ['boardId']),
  // Reserved foundations: no public guest-link or billing endpoints yet.
  boardLinks: defineTable({ boardId: v.id('boards'), tokenHash: v.string(), role: v.union(v.literal('viewer'), v.literal('editor')), expiresAt: v.optional(v.number()), revoked: v.boolean(), label:v.optional(v.string()), lastGuestAt:v.optional(v.number()) }).index('token', ['tokenHash']).index('board',['boardId']),
  linkMembers: defineTable({boardId:v.id('boards'),linkId:v.id('boardLinks'),userId:v.id('users')}).index('board_user',['boardId','userId']).index('user',['userId']),
  creditLedger: defineTable({ ownerId: v.id('users'), boardId: v.id('boards'), runId: v.id('runs'), amount: v.number(), kind: v.string() }).index('owner', ['ownerId']),
});
