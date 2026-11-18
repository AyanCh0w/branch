// The organization layer shared by every agent path. Agents send short structured
// items; the canvas shows only those, lanes keep them tidy, and the full reasoning is
// written to Context in the same transaction so people and other agents can follow it.
import { mutation, query } from '../definitions';
import { v } from '../validation';
import { access, tokenHash } from './access';
import { encodeDocument, initialDocument, loadDocument, readText } from './documents';
import { snapshotNode } from '../../app/context.js';
import { videoId } from '../../app/media.js';
import { place } from '../../app/auto-layout.js';
import * as shape from '../../app/plan-layout.js';

const { LIMITS, KINDS, STATUSES, KIND_LABEL, STATUS_LABEL, SIZE, BUDGET } = shape;
const scope = { token: v.string(), boardId: v.id('boards') };

// User-facing: safe to show an agent so it can correct the call.
export class PlanError extends Error {}
const fail = (message: string) => new PlanError('Fix and retry: ' + message);

export type Actor = { boardId: string; userId: string; agent: string; client?: string; connectionId?: string };
type Step = { id: string; title: string; status: string; note: string; detail?: string; archived?: boolean; sources?: any[] };
type Plan = { format?: number; goal: string; steps: Step[]; revision: number; updatedAt: number; updatedBy: string; log: any[] };

function block(value: unknown, label: string, max: number, required = true) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw fail(`${label} must be text.`);
  const text = value.trim();
  if (required && !text) throw fail(`${label} is required.`);
  if (text.length > max) {
    throw fail(`${label} is ${text.length} characters; the limit is ${max}. Keep what shows on the canvas short and put the full explanation in "detail", which is saved to Context.`);
  }
  return text;
}
const line = (value: unknown, label: string, max: number, required = true) =>
  block(typeof value === 'string' ? value.replace(/\s+/g, ' ') : value, label, max, required);
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'step';
const clip = (text: string, max: number) => text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
const identifier = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
    throw fail(`${label} must be 1–100 letters, numbers, dashes or underscores.`);
  }
  return value;
};
const hashed = async (...parts: unknown[]) => (await tokenHash(JSON.stringify(parts)));
function materialize(row: any) {
  const doc = loadDocument(row.textState);
  try { return { ...row.data, ...readText(doc), id: row.key }; } finally { doc.destroy(); }
}
const liveRows = async (ctx: any, boardId: string) =>
  (await ctx.db.query('nodes').withIndex('board_key', (q: any) => q.eq('boardId', boardId)).collect()).filter((row: any) => !row.deleted);
const structured = (node: any) => !!node?.plan && node.visualPlan && node.body === node.planBody;

function normalizeSteps(input: any, previous: Step[]): Step[] {
  if (!Array.isArray(input) || !input.length || input.length > LIMITS.steps) throw fail(`Use 1–${LIMITS.steps} steps.`);
  const known = new Map(previous.map(step => [step.title.toLowerCase(), step.id]));
  const used = new Set<string>();
  return input.map((raw: any, index: number) => {
    if (!raw || typeof raw !== 'object') throw fail(`Step ${index + 1} is invalid.`);
    const title = line(raw.title, `Step ${index + 1} title`, LIMITS.stepTitle);
    if (!STATUSES.includes(raw.status)) throw fail(`Step ${index + 1} status must be pending, working, done or blocked.`);
    const detail = block(raw.detail, `Step ${index + 1} detail`, LIMITS.stepDetail, false);
    let note = line(raw.note, `Step ${index + 1} note`, LIMITS.stepNote, false);
    // Older callers send only a long detail. Surface its first sentence when it is short.
    if (!note && detail && raw.note === undefined) {
      const first = detail.split(/(?<=[.!?])\s/)[0].replace(/\s+/g, ' ');
      if (first.length <= LIMITS.stepNote && first !== detail.replace(/\s+/g, ' ')) note = first;
    }
    const base = typeof raw.id === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(raw.id) ? raw.id : known.get(title.toLowerCase()) || slug(title);
    let id = base;
    for (let suffix = 2; used.has(id); suffix++) id = base + '-' + suffix;
    used.add(id);
    return { id, title, status: raw.status, note, ...(detail ? { detail } : {}) };
  });
}

function describeChanges(before: Plan | null, after: { goal: string; steps: Step[] }) {
  if (!before) return [`Plan with ${after.steps.length} step${after.steps.length === 1 ? '' : 's'}`];
  const changes: string[] = [];
  if (before.goal !== after.goal) changes.push('Goal updated');
  const old = new Map(before.steps.map(step => [step.id, step]));
  after.steps.forEach((step, index) => {
    const previous = old.get(step.id);
    old.delete(step.id);
    if (!previous) changes.push(`Added step ${index + 1} “${step.title}”`);
    else if (previous.status !== step.status) changes.push(`Step ${index + 1} “${step.title}”: ${STATUS_LABEL[previous.status]} → ${STATUS_LABEL[step.status]}`);
    else if (previous.title !== step.title) changes.push(`Step ${index + 1} renamed to “${step.title}”`);
    else if (previous.note !== step.note || previous.detail !== step.detail) changes.push(`Step ${index + 1} “${step.title}” notes updated`);
  });
  for (const step of old.values()) changes.push(`Removed step “${step.title}”`);
  if (!changes.length && before.steps.map(step => step.id).join() !== after.steps.map(step => step.id).join()) changes.push('Steps reordered');
  return changes;
}

const statusMark: Record<string, string> = { pending: '⬜', working: '🔄', done: '✅', blocked: '⛔' };
function planMarkdown(plan: { goal: string; steps: Step[] }) {
  return `**Goal:** ${plan.goal}\n\n` + plan.steps.map((step, index) =>
    `${index + 1}. ${statusMark[step.status]} **${step.title}** (${STATUS_LABEL[step.status].toLowerCase()})` +
    (step.note ? `\n   ${step.note}` : '') + (step.detail ? `\n   ${step.detail.replace(/\n/g, '\n   ')}` : '')).join('\n');
}

// Context rows belong to an agent connection. Account-authenticated agents (the local
// MCP server) get one implicit, keyless connection per person, client and board.
async function contextConnection(ctx: any, actor: Actor) {
  if (actor.connectionId) return ctx.db.get(actor.connectionId);
  const keyHash = 'account:' + actor.userId + ':' + actor.boardId + ':' + slug(actor.client || actor.agent);
  const existing = await ctx.db.query('boardAgentConnections').withIndex('key', (q: any) => q.eq('keyHash', keyHash)).unique();
  if (existing) return existing;
  const id = await ctx.db.insert('boardAgentConnections', {
    boardId: actor.boardId, userId: actor.userId, name: actor.agent, keyHash, mode: 'edit', revoked: false,
  });
  return ctx.db.get(id);
}
export const implicitConnection = (connection: any) => String(connection.keyHash).startsWith('account:');

// Every canvas change an agent makes leaves its full reasoning in Context.
async function logContext(ctx: any, actor: Actor, entry: { key: string; title: string; result: string; nodeKey?: string }) {
  const connection = await contextConnection(ctx, actor);
  if (!connection || connection.revoked) return null;
  const requestId = 'auto-' + (await hashed(entry.key)).slice(0, 48);
  const existing = await ctx.db.query('boardAgentUpdates')
    .withIndex('request', (q: any) => q.eq('connectionId', connection._id).eq('requestId', requestId)).unique();
  if (existing) return existing._id;
  const id = await ctx.db.insert('boardAgentUpdates', {
    boardId: actor.boardId, connectionId: connection._id, requestId, agentName: connection.name,
    title: clip(entry.title, 120), result: clip(entry.result, 8000), nodeKey: entry.nodeKey,
  });
  await ctx.db.patch(connection._id, { lastUpdateAt: Date.now() });
  return id;
}

export async function relayout(ctx: any, boardId: string, planKey: string) {
  const rows = await liveRows(ctx, boardId);
  const nodes = rows.map(materialize);
  const plan = nodes.find((node: any) => node.id === planKey && node.plan);
  if (!plan) return;
  const positions = shape.layout(plan, nodes.filter((node: any) => node.lane?.plan === planKey));
  for (const [key, point] of positions) {
    const row = rows.find((candidate: any) => candidate.key === key);
    if (row.data.x !== point.x || row.data.y !== point.y) await ctx.db.patch(row._id, { data: { ...row.data, x: point.x, y: point.y } });
  }
}

async function requireFreePlan(ctx: any, row: any, boardId: string) {
  const editors = await ctx.db.query('editors').withIndex('node', (q: any) => q.eq('boardId', boardId).eq('nodeKey', row.key)).collect();
  if (editors.some((editor: any) => editor.expiresAt > Date.now())) throw new PlanError('Someone is editing this plan. Try again after they finish.');
}

type PlanInput = {
  key: string; goal: string; steps: any[]; title?: string; expectedVersion?: number; summary?: string; detail?: string;
  origin?: any; shared?: boolean; byPerson?: boolean; goalLimit?: number; silent?: boolean; moves?: Record<string, string>;
};
export async function savePlan(ctx: any, actor: Actor, input: PlanInput) {
  const goal = line(input.goal, 'Goal', input.goalLimit || 4000);
  const row = await ctx.db.query('nodes').withIndex('board_key', (q: any) => q.eq('boardId', actor.boardId).eq('key', input.key)).unique();
  const now = Date.now();
  if (row) {
    if (row.deleted || !row.data.visualPlan || (!input.shared && row.createdBy !== actor.userId)) throw new PlanError('This plan cannot be updated.');
    const current = materialize(row);
    if (input.expectedVersion !== undefined && row.textVersion !== input.expectedVersion) {
      throw new PlanError(`Plan changed (now version ${row.textVersion}). Read it again with get_brief or read_board, merge your change, and retry with the new version.`);
    }
    await requireFreePlan(ctx, row, actor.boardId);
    // Never overwrite text a person typed into the plan card.
    if (current.body !== row.data.planBody) throw new PlanError('Plan was manually edited. Create a new plan to preserve those edits.');
    const before: Plan | null = row.data.plan || null;
    const { steps, rehomed } = await keepHomes(ctx, actor, row, before, normalizeSteps(input.steps, before?.steps || []), input.moves);
    const changes = [...rehomed, ...describeChanges(before && { ...before, steps: before.steps.filter(step => !step.archived) }, { goal, steps: steps.filter(step => !step.archived) })];
    const title = input.title && input.shared ? line(input.title, 'Plan title', LIMITS.planTitle) : row.data.title;
    if (before && !changes.length && title === row.data.title) return planResult(input.key, row.textVersion, before, false);
    const summary = line(input.summary, 'Summary', 280, false) || clip(changes.join('; '), 280);
    const agentId = input.byPerson || input.silent ? undefined : (await contextConnection(ctx, actor))?._id;
    const plan: Plan = {
      // A text-only plan an agent restructures starts in the current layout.
      ...(before?.format ? { format: before.format } : !before && !row.data.autoGroup ? { format: 2 } : {}),
      goal, steps, revision: (before?.revision || 0) + 1, updatedAt: now, updatedBy: actor.agent,
      log: [{ at: now, by: actor.agent, text: summary, ...(input.byPerson ? { person: true } : {}), ...(agentId ? { agentId } : {}) }, ...(before?.log || [])].slice(0, BUDGET.log),
    };
    const board = plan.format === 2;
    const body = shape.planText(plan);
    const doc = loadDocument(row.textState);
    try {
      doc.transact(() => {
        const text = doc.getText('body');
        text.delete(0, text.length); text.insert(0, body);
        // Keep a title a person renamed on the card.
        if (title !== row.data.title && doc.getText('title').toString() === row.data.title) {
          const heading = doc.getText('title');
          heading.delete(0, heading.length); heading.insert(0, title);
        }
      });
      const version = row.textVersion + 1;
      await ctx.db.patch(row._id, {
        textState: encodeDocument(doc), textVersion: version,
        data: {
          ...row.data, title, planBody: body, plan, revision: (row.data.revision || 1) + 1,
          ...(board ? { width: SIZE.plan } : row.data.autoGroup ? {} : { layoutHeight: shape.planHeight(plan) }),
        },
        updatedBy: actor.userId,
      });
      await ctx.db.patch(actor.boardId, { updatedAt: now });
      if (board) await syncStepCards(ctx, actor, input.key); else await relayout(ctx, actor.boardId, input.key);
      if (!input.byPerson && !input.silent) {
        await logContext(ctx, actor, {
          key: `plan:${input.key}:${version}`, title: 'Plan updated: ' + summary, nodeKey: input.key,
          result: [`**What changed:** ${changes.join('; ') || summary}`, block(input.detail, 'Detail', LIMITS.detail, false), planMarkdown(plan)].filter(Boolean).join('\n\n'),
        });
      }
      // Agents can't press Organize, so an agent's update brings an older-layout plan up to date.
      // It changes no text, and people can still use Undo organize on the plan.
      if (!input.byPerson && plan.format !== 2 && !row.data.autoGroup) {
        await organize(ctx, actor, input.key, true, { byAgent: true });
        return planResult(input.key, version + 1, { ...plan, format: 2 }, true);
      }
      return planResult(input.key, version, plan, true);
    } finally { doc.destroy(); }
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== -1) throw new PlanError('Plan not found. Use expectedVersion -1 to create it.');
  const steps = normalizeSteps(input.steps, []);
  const title = line(input.title || 'Plan', 'Plan title', LIMITS.planTitle);
  const summary = line(input.summary, 'Summary', 280, false) || describeChanges(null, { goal, steps })[0];
  const agentId = input.silent ? undefined : (await contextConnection(ctx, actor))?._id;
  // Plans made by the in-app research agent stay inside that agent's own workspace.
  const plan: Plan = { ...(input.origin ? {} : { format: 2 }), goal, steps, revision: 1, updatedAt: now, updatedBy: actor.agent, log: [{ at: now, by: actor.agent, text: summary, ...(agentId ? { agentId } : {}) }] };
  const body = shape.planText(plan);
  const others = (await liveRows(ctx, actor.boardId)).map((other: any) => other.data);
  const origin = input.origin;
  const location = origin
    ? place(others, { x: origin.x + (origin.width || 520) + 100, y: origin.y || 80 }, SIZE.plan, 600)
    : shape.origin(others);
  const data = {
    id: input.key, type: 'plan', title, body, ...location, width: SIZE.plan, revision: 1, titleEdited: true,
    visualPlan: true, planBody: body, plan, author: actor.agent, ...(origin ? { autoGroup: origin.id } : { layoutHeight: 640 }), contexts: [],
  };
  await ctx.db.insert('nodes', {
    boardId: actor.boardId, key: input.key, data, textState: initialDocument(data), textVersion: 0,
    createdBy: actor.userId, updatedBy: actor.userId, deleted: false,
  });
  await syncStepCards(ctx, actor, input.key);
  await ctx.db.patch(actor.boardId, { updatedAt: now });
  if (!input.silent) await logContext(ctx, actor, {
    key: `plan:${input.key}:0`, title: 'Plan created: ' + title, nodeKey: input.key,
    result: [block(input.detail, 'Detail', LIMITS.detail, false), planMarkdown(plan)].filter(Boolean).join('\n\n'),
  });
  return planResult(input.key, 0, plan, true);
}
const planResult = (key: string, version: number, plan: Plan, changed: boolean) => ({
  id: key, version, changed,
  steps: plan.steps.filter(step => !step.archived).map((step, index) => ({ number: index + 1, id: step.id, title: step.title, status: step.status })),
});

// Each step is its own card on the board, so people can move it, open it and connect
// it like any other card. This keeps those cards in line with the plan's steps.
const stepKey = (planKey: string, step: string) => 'step-' + planKey + '-' + (step || 'unsorted');
export async function syncStepCards(ctx: any, actor: Actor, planKey: string) {
  const rows = await liveRows(ctx, actor.boardId);
  const planRow = rows.find((row: any) => row.key === planKey);
  if (!planRow) return;
  const plan: Plan = planRow.data.plan, board = plan.format === 2 && !planRow.data.autoGroup;
  const cards = rows.filter((row: any) => row.data.lane?.plan === planKey && row.data.brief && !row.data.visualPlan);
  const wanted = new Map<string, { step: string; title: string; note: string }>();
  if (board) {
    for (const step of plan.steps.filter(item => !item.archived)) wanted.set(stepKey(planKey, step.id), { step: step.id, title: step.title, note: step.note || '' });
    const known = new Set(plan.steps.map(item => item.id));
    if (cards.some((row: any) => !row.data.brief.step || !known.has(row.data.brief.step))) {
      wanted.set(stepKey(planKey, ''), { step: '', title: 'Unsorted', note: 'Cards without a step. Open one and choose Edit to file it.' });
    }
  }
  for (const row of rows.filter((candidate: any) => candidate.data.stepCard?.plan === planKey)) {
    const want = wanted.get(row.key);
    wanted.delete(row.key);
    if (!want) { await ctx.db.patch(row._id, { deleted: true }); continue; }
    const current = materialize(row);
    if (current.title !== want.title || current.body !== want.note) await writeCardText(ctx, row, want.title, want.note, { ...row.data, title: want.title, body: want.note }, actor.userId);
  }
  for (const [key, want] of wanted) {
    const data = {
      id: key, type: 'plan', title: want.title, body: want.note, x: planRow.data.x, y: planRow.data.y + 320, width: SIZE.card, revision: 1,
      titleEdited: true, author: actor.agent, stepCard: { plan: planKey, step: want.step }, lane: { plan: planKey, role: 'step', seq: 0 }, contexts: [],
    };
    const old = await ctx.db.query('nodes').withIndex('board_key', (q: any) => q.eq('boardId', actor.boardId).eq('key', key)).unique();
    if (old) await ctx.db.patch(old._id, { data: { ...data, lane: old.data.lane || data.lane }, deleted: false });
    else await ctx.db.insert('nodes', { boardId: actor.boardId, key, data, textState: initialDocument(data), textVersion: 0, createdBy: actor.userId, updatedBy: actor.userId, deleted: false });
  }
}

// Every card keeps a home. A step that still holds cards cannot simply disappear: the
// caller says where its cards go, or archives the step with them inside.
async function keepHomes(ctx: any, actor: Actor, planRow: any, before: Plan | null, incoming: Step[], moves?: Record<string, string>) {
  const rehomed: string[] = [];
  if (!before) return { steps: incoming, rehomed };
  const previous = new Map(before.steps.map(step => [step.id, step]));
  const kept = new Set(incoming.map(step => step.id));
  // Steps keep what the caller does not send: their sources and archived state.
  let steps: Step[] = incoming.map(step => ({ ...(previous.get(step.id)?.sources ? { sources: previous.get(step.id)!.sources } : {}), ...step }));
  const rows = await liveRows(ctx, actor.boardId);
  const cardsOf = (id: string) => rows.filter((row: any) => row.data.lane?.plan === planRow.key && row.data.brief && row.data.brief.step === id);
  for (const step of before.steps) {
    if (kept.has(step.id)) continue;
    if (step.archived) { steps.push(step); continue; }
    const cards = cardsOf(step.id);
    if (!cards.length && !step.sources?.length) continue;
    const target = moves && Object.hasOwn(moves, step.id) ? String(moves[step.id]) : '';
    if (target === 'archive') {
      steps.push({ ...step, archived: true });
      rehomed.push(`Archived “${step.title}” with its ${cards.length} card${cards.length === 1 ? '' : 's'}`);
    } else if (kept.has(target)) {
      for (const card of cards) await ctx.db.patch(card._id, { data: { ...card.data, brief: { ...card.data.brief, step: target } } });
      const to = steps.find(candidate => candidate.id === target)!;
      if (step.sources?.length) to.sources = [...(to.sources || []), ...step.sources];
      rehomed.push(`Moved ${cards.length} card${cards.length === 1 ? '' : 's'} from “${step.title}” to “${to.title}”`);
    } else {
      throw fail(`Step "${step.id}" has ${cards.length} card${cards.length === 1 ? '' : 's'} and is missing from this update. Keep its id, or add moves: {"${step.id}": "<new step id>"} or {"${step.id}": "archive"}.`);
    }
  }
  return { steps, rehomed };
}

async function boardPlan(ctx: any, boardId: string, planKey?: string) {
  const rows = await liveRows(ctx, boardId);
  const plans = rows.filter((row: any) => row.data.visualPlan && row.data.plan && !row.data.autoGroup);
  if (planKey) {
    const row = plans.find((candidate: any) => candidate.key === planKey);
    if (!row) throw fail('That plan does not exist on this board. Call get_brief to see the current plan.');
    return { row, rows };
  }
  plans.sort((a: any, b: any) => (b.data.plan.updatedAt || 0) - (a.data.plan.updatedAt || 0));
  return { row: plans[0] || null, rows };
}

function resolveStep(plan: Plan, value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim().toLowerCase();
  const live = plan.steps.filter(candidate => !candidate.archived);
  const byNumber = /^\d+$/.test(text) ? live[Number(text) - 1] : null;
  const step = live.find(candidate => candidate.id === text) || byNumber;
  if (!step) throw fail(`Step "${String(value).slice(0, 40)}" is not in the plan. Use a step number from 1 to ${live.length}, or a step id from get_brief.`);
  return step.id;
}

function publicUrl(raw: unknown) {
  let url: URL;
  try { url = new URL(String(raw)); } catch { throw fail('A source url must be a complete http(s) address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail('Use a public http(s) source url.');
  return url;
}

const sourceKind = (node: any) => node.type === 'media' ? 'video' : node.type === 'upload' ? 'file' : node.type === 'github' ? 'github' : 'website';
const sourceAddress = (node: any) => node.type === 'media' ? node.source : node.url || '';

// Sources become the board's own card types: a website, a YouTube video or a file.
async function ensureSource(ctx: any, actor: Actor, rows: any[], spec: any,
  lane: { plan?: string; parent?: string; step?: string | null; seq: number }, legacy?: { key: string; body: string }) {
  if (!spec || typeof spec !== 'object') throw fail('Each source needs a url, a file, or the cardId of a card already on the board.');
  const note = line(spec.note, 'Source note', LIMITS.sourceNote, false);
  if (spec.cardId) {
    const row = rows.find((candidate: any) => candidate.key === spec.cardId);
    if (!row) throw fail(`Source card "${String(spec.cardId).slice(0, 60)}" is not on this board.`);
    if (!['web', 'media', 'upload', 'plan', 'github'].includes(row.data.type)) throw fail('Cite a website, video, file, GitHub or note card.');
    return { row, created: false };
  }
  let data: any, key: string;
  if (spec.file) {
    const name = line(spec.file.name, 'File name', LIMITS.sourceTitle);
    const text = block(spec.file.text, 'File text', LIMITS.fileText);
    key = 'src-' + (await hashed('file', name, text)).slice(0, 24);
    const mime = /\.md$/i.test(name) ? 'text/markdown' : /\.json$/i.test(name) ? 'application/json' : /\.csv$/i.test(name) ? 'text/csv' : 'text/plain';
    data = { type: 'upload', title: name, asset: key, mime, size: new TextEncoder().encode(text).length, text };
  } else {
    const url = publicUrl(spec.url);
    const video = videoId(url.href);
    key = 'src-' + (await hashed('url', video ? 'youtube:' + video : url.href)).slice(0, 24);
    const title = line(spec.title, 'Source title', LIMITS.sourceTitle, false);
    data = video
      ? { type: 'media', mediaType: 'video', videoId: video, source: 'https://www.youtube.com/watch?v=' + video, title: title || 'YouTube video' }
      : { type: 'web', title: title || url.hostname.replace(/^www\./, ''), url: url.href, body: legacy?.body || '' };
  }
  // Only the server's own compatibility path may choose a card id.
  if (legacy) key = legacy.key;
  const existing = rows.find((candidate: any) => candidate.key === key);
  if (existing) return { row: existing, created: false };
  const node = {
    ...data, id: key, x: 0, y: 0, width: SIZE.source, revision: 1, titleEdited: true, author: actor.agent,
    ...(note ? { sourceNote: note } : {}), lane: { ...lane, role: 'source' },
  };
  // Other placement code steers around cards by this height.
  node.layoutHeight = shape.sourceHeight(node);
  const id = await ctx.db.insert('nodes', {
    boardId: actor.boardId, key, data: node, textState: initialDocument(node), textVersion: 0,
    createdBy: actor.userId, updatedBy: actor.userId, deleted: false,
  });
  const row = await ctx.db.get(id);
  rows.push(row);
  return { row, created: true };
}

const nextSequence = (rows: any[], planKey?: string) =>
  rows.reduce((max: number, row: any) => row.data.lane && row.data.lane.plan === planKey ? Math.max(max, Number(row.data.lane.seq) || 0) : max, 0) + 1;

async function placeLoose(ctx: any, boardId: string, key: string, width: number, height: number) {
  const rows = await liveRows(ctx, boardId);
  const row = rows.find((candidate: any) => candidate.key === key);
  const location = place(rows.filter((other: any) => other.key !== key).map((other: any) => other.data), { x: 600, y: 80 }, width, height);
  await ctx.db.patch(row._id, { data: { ...row.data, ...location } });
}

type CardInput = {
  key: string; kind: string; title: string; summary: string; points?: any; step?: unknown; detail?: string;
  sources?: any[]; planKey?: string; contexts?: any[]; detailLimit?: number; replaces?: string[];
  files?: unknown; related?: unknown;
};
async function saveFloatingCard(ctx: any, actor: Actor, input: CardInput) {
  if (!KINDS.includes(input.kind)) throw fail('kind must be one of ' + KINDS.join(', ') + '.');
  const title = line(input.title, 'Title', LIMITS.title);
  const summary = line(input.summary, 'Summary', LIMITS.summary);
  if (input.points !== undefined && !Array.isArray(input.points)) throw fail('points must be a list of short lines.');
  const points = (input.points || []).map((point: unknown, index: number) => line(point, `Point ${index + 1}`, LIMITS.point));
  if (points.length > LIMITS.points) throw fail(`Use at most ${LIMITS.points} points. Move the rest into "detail".`);
  const detail = block(input.detail, 'Detail', input.detailLimit || LIMITS.detail, false);
  const specs = input.sources || [];
  if (!Array.isArray(specs) || specs.length > LIMITS.sources) throw fail(`Cite at most ${LIMITS.sources} sources per card.`);

  const { row: planRow, rows } = await boardPlan(ctx, actor.boardId, input.planKey);
  const existing = (await ctx.db.query('nodes').withIndex('board_key', (q: any) => q.eq('boardId', actor.boardId).eq('key', input.key)).unique());
  if (existing) {
    if (existing.deleted || existing.createdBy !== actor.userId) throw new PlanError('Card ID unavailable. Use a new ID.');
    return { id: input.key, created: false };
  }
  const planNode = planRow ? materialize(planRow) : null;
  const usable = planNode && structured(planNode);
  const step = usable ? resolveStep(planNode.plan, input.step) : null;
  if (usable && rows.filter((row: any) => row.data.lane?.plan === planRow.key).length >= 80) {
    throw new PlanError('This plan already has 80 cards. Update or remove existing cards before adding more.');
  }
  const now = Date.now();
  const seq = nextSequence(rows, planRow?.key);
  const nodes = rows.map(materialize);
  const contexts: any[] = [...(input.contexts || [])];
  if (planNode) contexts.push({ id: input.key + '-plan', ...snapshotNode(planNode, nodes) });
  const cited: any[] = [];
  let offset = 0;
  for (const spec of specs) {
    const source = await ensureSource(ctx, actor, rows, spec,
      { ...(usable ? { plan: planRow.key } : {}), parent: input.key, step, seq: seq + ++offset });
    if (cited.some(item => item.row.key === source.row.key)) continue;
    cited.push(source);
    const waiting = source.row.data.lane;
    if (!source.created && usable && waiting?.role === 'source' && waiting.plan === planRow.key && !waiting.parent) {
      source.row.data = { ...source.row.data, lane: { ...waiting, parent: input.key, step } };
      await ctx.db.patch(source.row._id, { data: source.row.data });
    }
    const node = materialize(source.row);
    contexts.push({ id: input.key + '-' + source.row.key, ...snapshotNode(node, [...nodes, node]), cite: true });
  }
  const agentId = (await contextConnection(ctx, actor))?._id;
  const brief = {
    kind: input.kind, summary, points, step, text: '', ...(detail ? { detail } : {}), by: actor.agent, at: now,
    sources: cited.map(item => item.row.key), ...(agentId ? { agentId } : {}),
  };
  brief.text = shape.cardText(brief);
  const data = {
    id: input.key, type: 'plan', title, body: brief.text, x: 0, y: 0, width: SIZE.card, revision: 1, titleEdited: true,
    author: actor.agent, brief, contexts, layoutHeight: shape.cardHeight(brief), ...(usable ? { lane: { plan: planRow.key, role: 'card', seq } } : {}),
  };
  await ctx.db.insert('nodes', {
    boardId: actor.boardId, key: input.key, data, textState: initialDocument(data), textVersion: 0,
    createdBy: actor.userId, updatedBy: actor.userId, deleted: false,
  });
  if (usable) await relayout(ctx, actor.boardId, planRow.key);
  else {
    await placeLoose(ctx, actor.boardId, input.key, SIZE.card, shape.cardHeight(brief));
    for (const item of cited) if (item.created) await placeLoose(ctx, actor.boardId, item.row.key, SIZE.source, shape.sourceHeight(item.row.data));
  }
  await ctx.db.patch(actor.boardId, { updatedAt: now });
  const stepTitle = step ? planNode.plan.steps.find((candidate: Step) => candidate.id === step)?.title : '';
  await logContext(ctx, actor, {
    key: `card:${input.key}`, title: `${KIND_LABEL[input.kind]}: ${title}`, nodeKey: input.key,
    result: [
      summary, points.map((point: string) => '- ' + point).join('\n'), detail,
      cited.length ? '**Sources**\n' + cited.map(item => `- ${item.row.data.title}${sourceAddress(item.row.data) ? ' — ' + sourceAddress(item.row.data) : ''}`).join('\n') : '',
      stepTitle ? `_Plan step: ${stepTitle}_` : '',
    ].filter(Boolean).join('\n\n'),
  });
  return {
    id: input.key, created: true, kind: input.kind, step,
    sources: cited.map(item => ({ id: item.row.key, kind: sourceKind(item.row.data), title: item.row.data.title })),
    ...(planRow ? { plan: { id: planRow.key, version: planRow.textVersion } } : {}),
  };
}

type SourceInput = { url?: string; file?: any; cardId?: string; title?: string; note?: string; forCard?: string; step?: unknown; planKey?: string };
async function saveFloatingSource(ctx: any, actor: Actor, input: SourceInput, legacy?: { key: string; body: string }) {
  const { row: planRow, rows } = await boardPlan(ctx, actor.boardId, input.planKey);
  const planNode = planRow ? materialize(planRow) : null;
  const usable = planNode && structured(planNode);
  let parent: any = null;
  if (input.forCard) {
    parent = rows.find((row: any) => row.key === input.forCard);
    if (!parent) throw fail(`Card "${String(input.forCard).slice(0, 60)}" is not on this board.`);
    if (parent.data.type !== 'plan' || parent.data.visualPlan) throw fail('Attach sources to a decision, finding, question, risk or note card.');
  }
  const step = usable ? (parent?.data.brief?.step ?? resolveStep(planNode.plan, input.step)) : null;
  const source = await ensureSource(ctx, actor, rows, input, {
    ...(usable ? { plan: planRow.key } : {}), ...(parent ? { parent: parent.key } : {}), step, seq: nextSequence(rows, planRow?.key),
  }, legacy);
  if (parent && !(parent.data.contexts || []).some((context: any) => context.source === source.row.key)) {
    if ((parent.data.contexts || []).length >= 16) throw new PlanError('This card already has 16 connections.');
    const nodes = rows.map(materialize);
    const context = { id: parent.key + '-' + source.row.key, ...snapshotNode(materialize(source.row), nodes), cite: true };
    const brief = parent.data.brief ? { ...parent.data.brief, sources: [...(parent.data.brief.sources || []), source.row.key] } : undefined;
    await ctx.db.patch(parent._id, { data: { ...parent.data, contexts: [...(parent.data.contexts || []), context], ...(brief ? { brief } : {}) } });
  }
  if (usable) await relayout(ctx, actor.boardId, planRow.key);
  else if (source.created) await placeLoose(ctx, actor.boardId, source.row.key, SIZE.source, shape.sourceHeight(source.row.data));
  await ctx.db.patch(actor.boardId, { updatedAt: Date.now() });
  if (source.created) {
    await logContext(ctx, actor, {
      key: `source:${source.row.key}`, title: 'Source: ' + source.row.data.title, nodeKey: source.row.key,
      result: [sourceAddress(source.row.data), source.row.data.sourceNote, parent ? `_Supports: ${materialize(parent).title}_` : ''].filter(Boolean).join('\n\n') || source.row.data.title,
    });
  }
  return { id: source.row.key, created: source.created, kind: sourceKind(source.row.data), title: source.row.data.title };
}

// A person's decision is recorded once and reflected on the shared plan for everyone.
type DecisionInput = Omit<CardInput, 'kind'> & { planChanges?: any[]; replaces?: string[] };
export async function recordDecision(ctx: any, actor: Actor, input: DecisionInput) {
  const card = await saveCard(ctx, actor, { ...input, kind: 'decision' });
  const changes = input.planChanges || [];
  if (!Array.isArray(changes) || changes.length > LIMITS.steps) throw fail('planChanges must be a short list of step changes.');
  if (!card.created || !changes.length) return { ...card, planUpdate: null };
  const { row } = await boardPlan(ctx, actor.boardId, input.planKey);
  const node = row ? materialize(row) : null;
  if (!node || !structured(node)) return { ...card, planUpdate: { applied: false, reason: 'There is no structured plan to update.' } };
  const steps: any[] = node.plan.steps.filter((step: Step) => !step.archived).map((step: Step) => ({ ...step }));
  for (const change of changes) {
    const id = resolveStep(node.plan, change?.step);
    const step = steps.find(candidate => candidate.id === id);
    if (!step) throw fail('Each plan change needs the step number or id it applies to.');
    if (change.status !== undefined) step.status = change.status;
    if (change.title !== undefined) step.title = change.title;
    if (change.note !== undefined) step.note = change.note;
  }
  try {
    const plan = await savePlan(ctx, actor, {
      key: row.key, goal: node.plan.goal, steps, expectedVersion: row.textVersion, shared: true,
      summary: clip('Decision: ' + line(input.title, 'Title', LIMITS.title), 280),
    });
    return { ...card, plan: { id: row.key, version: plan.version }, planUpdate: { applied: true, version: plan.version, steps: plan.steps } };
  } catch (error) {
    if (error instanceof PlanError && !error.message.startsWith('Fix and retry')) {
      return { ...card, planUpdate: { applied: false, reason: error.message } };
    }
    throw error;
  }
}

// The agent-facing digest of the board: small, structured and current.
export async function boardBrief(ctx: any, boardId: string) {
  const board = await ctx.db.get(boardId);
  const rows = await liveRows(ctx, boardId);
  const nodes = rows.map((row: any) => ({ ...materialize(row), version: row.textVersion }));
  const plans = nodes.filter((node: any) => node.visualPlan && node.plan && !node.autoGroup)
    .sort((a: any, b: any) => (b.plan.updatedAt || 0) - (a.plan.updatedAt || 0));
  const main = plans[0] || null;
  // Closed cards (answered questions, superseded findings) are history, not current state.
  const cards = nodes.filter((node: any) => node.brief && !node.visualPlan && !node.brief.closed).sort((a: any, b: any) => b.brief.at - a.brief.at);
  const item = (node: any) => ({
    id: node.id, title: node.title, summary: node.body === node.brief.text ? node.brief.summary : clip(node.body, 300), step: node.brief.step || null,
    by: node.brief.editedBy || node.brief.by, at: new Date(node.brief.editedAt || node.brief.at).toISOString(), revision: node.brief.rev || 1,
    ...(node.brief.sources?.length ? { sources: node.brief.sources.length } : {}),
  });
  const ofKind = (kind: string) => cards.filter((node: any) => node.brief.kind === kind).slice(0, 12).map(item);
  const instructions = await ctx.db.query('boardAgentInstructions').withIndex('board', (q: any) => q.eq('boardId', boardId)).unique();
  const live = main && structured(main) ? main.plan.steps.filter((step: Step) => !step.archived) : [];
  const mine = (step: string | null) => cards.filter((node: any) => node.lane?.plan === main.id && (node.brief.step || null) === step)
    .map((node: any) => ({ id: node.id, kind: node.brief.kind, title: node.title }));
  const check = main && structured(main) ? shape.health(main, nodes) : null;
  return {
    board: { id: boardId, title: board.title },
    instructions: instructions?.text || '',
    plan: main ? (structured(main) ? {
      planId: main.id.replace(/^plan-/, ''), cardId: main.id, version: main.version, title: main.title, goal: main.plan.goal,
      progress: shape.progress({ steps: live }),
      steps: live.map((step: Step, index: number) => ({
        number: index + 1, id: step.id, title: step.title, status: step.status, ...(step.note ? { note: step.note } : {}), cards: mine(step.id),
      })),
      ...(mine(null).length ? { unsorted: mine(null) } : {}),
      ...(main.plan.steps.length > live.length ? { archivedSteps: main.plan.steps.length - live.length } : {}),
      recentChanges: (main.plan.log || []).slice(0, 5).map((entry: any) => ({ at: new Date(entry.at).toISOString(), by: entry.by, change: entry.text })),
      ...(check && !check.ok ? { needsOrganizing: check.issues.map(issue => `${issue.count} ${issue.text}`) } : {}),
    } : { cardId: main.id, version: main.version, title: main.title, editedByHand: true, text: clip(main.body, 4000) }) : null,
    otherPlans: plans.slice(1, 6).map((node: any) => ({ cardId: node.id, title: node.title })),
    decisions: ofKind('decision'), openQuestions: ofKind('question'), risks: ofKind('risk'), findings: [...ofKind('finding'), ...ofKind('note')].slice(0, 12),
    otherCards: nodes.filter((node: any) => !node.brief && !node.lane && !node.visualPlan).length,
    guidance: main
      ? 'Work from this plan. Add as many steps and cards as the project needs. Before adding a card, check the step for one on the same topic and revise it with revise_card. Record decisions with record_decision, and keep step ids when you change the plan.'
      : 'No plan yet. If the task has several steps, create one with update_plan (expectedVersion -1) before working.',
  };
}

// ---- What each agent is sent --------------------------------------------------------
// Every agent gets the plan. Beyond that it gets the cards near what it is working on,
// each with the reason, within a fixed budget, and after its first read only what
// changed. What it was sent is kept on the plan card so people can see it and pin or
// mute cards for that agent.
const READS_KEPT = 12;
type Focus = { step?: unknown; files?: unknown; topic?: unknown };
const editTime = (brief: any) => Math.max(brief.editedAt || 0, brief.at || 0);
const yours = (brief: any, connection: any) => String(brief.agentId || '') === String(connection._id) || brief.by === connection.name || brief.editedBy === connection.name;

async function wholeBoard(ctx: any, boardId: string, nodes: any[]) {
  const entries = await ctx.db.query('boardAgentUpdates').withIndex('timeline', (q: any) => q.eq('boardId', boardId)).collect();
  const cards = nodes.filter((node: any) => node.brief || node.visualPlan)
    .map((node: any) => [node.title, node.body, node.brief?.detail, node.brief?.sources, node.plan]);
  return shape.estimate(cards) + shape.estimate(entries.map((entry: any) => [entry.title, entry.result]));
}

export async function deliverBrief(ctx: any, actor: Actor, input: { focus?: Focus; full?: boolean } = {}) {
  const { risks, findings, ...core } = await boardBrief(ctx, actor.boardId);
  const { row: planRow, rows } = await boardPlan(ctx, actor.boardId);
  const planNode = planRow ? materialize(planRow) : null;
  const connection = boardOf(planNode) ? await contextConnection(ctx, actor) : null;
  if (!planRow || !connection || connection.revoked) return { ...core, risks, findings };
  const id = String(connection._id), lens = planRow.data.lens || {};
  const previous = lens.reads?.[id], prefs = lens.prefs?.[id] || {};
  const nodes = rows.map(materialize);
  const all = nodes.filter((node: any) => node.brief && !node.visualPlan && node.lane?.plan === planRow.key);
  const cards = all.filter((node: any) => !node.brief.closed);
  const live = planNode.plan.steps.filter((step: Step) => !step.archived);

  // What the agent is working on: what it says, else what it said last time, else its latest card.
  let focus: { step: string | null; files: string[]; topic: string }, basis: string;
  const asked = input.focus && typeof input.focus === 'object' ? input.focus : null;
  if (asked && (asked.step !== undefined || asked.files !== undefined || asked.topic !== undefined)) {
    focus = {
      step: asked.step === undefined || asked.step === null || asked.step === '' ? null : resolveStep(planNode.plan, asked.step),
      files: cleanFiles(asked.files) || [], topic: line(asked.topic, 'Focus topic', LIMITS.topic, false),
    };
    basis = 'what you said you are working on';
  } else if (previous?.focus) {
    focus = previous.focus; basis = 'what you said last time';
  } else {
    const latest = cards.filter((node: any) => yours(node.brief, connection)).sort((a: any, b: any) => editTime(b.brief) - editTime(a.brief))[0];
    const working = live.find((step: Step) => step.status === 'working');
    focus = { step: latest?.brief.step || working?.id || null, files: [], topic: '' };
    basis = latest ? 'your latest card' : working ? 'the step in progress' : 'nothing yet: pass focus to get cards for your work';
  }
  if (focus.step && !live.some((step: Step) => step.id === focus.step)) focus = { ...focus, step: null };

  const since = previous?.at || 0, sentBefore = new Set<string>(previous?.cards || []);
  const items: any[] = [], skipped: any[] = [];
  let used = 0;
  for (const entry of shape.rank(cards, focus, prefs, nodes)) {
    const card = cards.find((node: any) => node.id === entry.id);
    const unchanged = !input.full && sentBefore.has(card.id) && editTime(card.brief) <= since;
    const links = shape.linksOf(card, nodes).filter((link: any) => all.some((node: any) => node.id === link.id)).slice(0, 6);
    const item = unchanged ? { id: card.id, title: card.title, why: entry.why, unchanged: true } : {
      id: card.id, kind: card.brief.kind, title: card.title,
      summary: card.body === card.brief.text ? card.brief.summary : clip(card.body, 300),
      ...(card.body === card.brief.text && card.brief.points?.length ? { points: card.brief.points } : {}),
      step: card.brief.step || null, revision: card.brief.rev || 1, by: card.brief.editedBy || card.brief.by,
      ...(card.brief.files?.length ? { files: card.brief.files } : {}), ...(links.length ? { related: links } : {}),
      ...(card.brief.detail ? { hasDetail: true } : {}), why: entry.why,
    };
    const cost = shape.estimate(item);
    if (!entry.pinned && used + cost > shape.RELEVANCE.budget) { skipped.push({ id: card.id, title: card.title, why: entry.why }); continue; }
    used += cost;
    items.push(item);
  }

  // After the first read, everything teammates changed since then, in one list.
  const changes = !previous ? null : [
    ...all.filter((node: any) => node.brief.closed && node.brief.closed.at > since && node.brief.closed.by !== connection.name)
      .map((node: any) => ({ id: node.id, title: node.title, change: node.brief.closed.reason, by: node.brief.closed.by })),
    ...all.filter((node: any) => editTime(node.brief) > since && !yours({ by: node.brief.editedBy || node.brief.by }, connection))
      .map((node: any) => ({ id: node.id, title: node.title, change: node.brief.editedAt > since ? 'revised' : 'added', by: node.brief.editedBy || node.brief.by })),
    ...(planNode.plan.log || []).filter((entry: any) => entry.at > since && entry.by !== connection.name).map((entry: any) => ({ change: entry.text, by: entry.by })),
  ].slice(0, 30);

  const stepTitle = focus.step ? live.find((step: Step) => step.id === focus.step)?.title : '';
  const result = {
    ...core,
    forYou: {
      focus: { ...focus, ...(stepTitle ? { stepTitle } : {}) }, basedOn: basis, cards: items,
      ...(skipped.length ? { alsoRelated: skipped } : {}),
      note: 'Cards picked for your work, each with the reason. Cards marked unchanged are as you last saw them. When your work changes, call get_brief with focus; read_card opens any card in full.',
    },
    ...(changes ? { sinceYourLastRead: { at: new Date(since).toISOString(), changes } } : {}),
  };
  const read = {
    name: connection.name, at: Date.now(), focus, basis, tokens: shape.estimate(result), whole: await wholeBoard(ctx, actor.boardId, nodes),
    cards: items.map(item => item.id),
    items: items.map(item => ({ card: item.id, why: item.why, tokens: shape.estimate(item), ...(item.unchanged ? { unchanged: true } : {}) })),
    ...(skipped.length ? { skipped: skipped.map(item => ({ card: item.id, why: item.why })) } : {}),
  };
  const reads = Object.fromEntries(Object.entries({ ...(lens.reads || {}), [id]: read }).sort((a: any, b: any) => b[1].at - a[1].at).slice(0, READS_KEPT));
  await ctx.db.patch(planRow._id, { data: { ...planRow.data, lens: { ...lens, reads } } });
  return result;
}

const actorFor = async (ctx: any, args: { token: string; boardId: string; agent?: string }) => {
  const { userId } = await access(ctx, args.token, args.boardId, true);
  const user = await ctx.db.get(userId);
  const client = String(args.agent || '').replace(/[^\w .()+-]/g, '').trim().slice(0, 40) || 'Agent';
  return { boardId: args.boardId, userId, client, agent: clip(client + (user?.name ? ' · ' + user.name : ''), 80) } as Actor;
};
const agentArg = { agent: v.optional(v.string()) };
const cardArgs = {
  cardId: v.string(), planId: v.optional(v.string()), title: v.string(), summary: v.string(), points: v.optional(v.array(v.string())),
  step: v.optional(v.union(v.string(), v.number())), detail: v.optional(v.string()), sources: v.optional(v.array(v.any())),
  replaces: v.optional(v.array(v.string())), files: v.optional(v.array(v.string())), related: v.optional(v.array(v.any())),
};
const planKeyOf = (planId?: string) => planId === undefined ? undefined : 'plan-' + identifier(planId, 'planId');
// Without an explicit id, agents work on the board's current plan rather than starting a second one.
export async function resolvePlanKey(ctx: any, boardId: string, planId?: string) {
  if (planId !== undefined) return 'plan-' + identifier(planId, 'planId');
  return (await boardPlan(ctx, boardId)).row?.key || 'plan-main';
}

export const updatePlan = mutation({
  args: {
    ...scope, ...agentArg, planId: v.optional(v.string()), title: v.optional(v.string()), goal: v.string(), steps: v.array(v.any()),
    expectedVersion: v.number(), summary: v.optional(v.string()), detail: v.optional(v.string()), moves: v.optional(v.any()),
  },
  handler: async (ctx, args) => savePlan(ctx, await actorFor(ctx, args), {
    key: await resolvePlanKey(ctx, args.boardId, args.planId), title: args.title, goal: args.goal, steps: args.steps,
    expectedVersion: args.expectedVersion, summary: args.summary, detail: args.detail, shared: true, goalLimit: LIMITS.goal, moves: args.moves,
  }),
});

export const addCard = mutation({
  args: { ...scope, ...agentArg, ...cardArgs, kind: v.string() },
  handler: async (ctx, args) => saveCard(ctx, await actorFor(ctx, args), {
    ...args, key: 'mcp-' + identifier(args.cardId, 'cardId'), planKey: planKeyOf(args.planId),
  }),
});

export const recordDecisionCard = mutation({
  args: { ...scope, ...agentArg, ...cardArgs, planChanges: v.optional(v.array(v.any())) },
  handler: async (ctx, args) => recordDecision(ctx, await actorFor(ctx, args), {
    ...args, key: 'mcp-' + identifier(args.cardId, 'cardId'), planKey: planKeyOf(args.planId),
  }),
});

export const addSource = mutation({
  args: {
    ...scope, ...agentArg, planId: v.optional(v.string()), url: v.optional(v.string()), file: v.optional(v.any()),
    cardId: v.optional(v.string()), title: v.optional(v.string()), note: v.optional(v.string()),
    forCard: v.optional(v.string()), step: v.optional(v.union(v.string(), v.number())),
  },
  handler: async (ctx, args) => saveSource(ctx, await actorFor(ctx, args), { ...args, planKey: planKeyOf(args.planId) }),
});

export const brief = query({
  args: scope,
  handler: async (ctx, args) => {
    await access(ctx, args.token, args.boardId);
    return boardBrief(ctx, args.boardId);
  },
});

// An agent's read: the plan, then the cards for its work. Viewers' agents read without
// leaving a record, since they cannot change the board.
export const briefForAgent = mutation({
  args: { ...scope, ...agentArg, focus: v.optional(v.any()), full: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { membership } = await access(ctx, args.token, args.boardId);
    if (membership.role === 'viewer') return boardBrief(ctx, args.boardId);
    return deliverBrief(ctx, await actorFor(ctx, args), { focus: args.focus, full: args.full });
  },
});

// People decide, per agent, which cards it must always get and which it never needs.
export const setAgentCard = mutation({
  args: { ...scope, nodeKey: v.string(), agentId: v.string(), card: v.string(), pref: v.string() },
  handler: async (ctx, args) => {
    const actor = await personActor(ctx, args);
    if (!['pin', 'mute', 'none'].includes(args.pref)) throw fail('pref must be pin, mute or none.');
    const { row, rows } = await boardPlanCard(ctx, args.boardId, args.nodeKey);
    const lens = row.data.lens || {};
    if (!lens.reads?.[args.agentId]) throw new PlanError('That agent has not read this board yet.');
    if (!cardRow(rows, args.card)) throw new PlanError('That card is no longer on this board.');
    const old = lens.prefs?.[args.agentId] || {};
    const pinned = (old.pinned || []).filter((key: string) => key !== args.card), muted = (old.muted || []).filter((key: string) => key !== args.card);
    if (args.pref === 'pin') pinned.push(args.card);
    if (args.pref === 'mute') muted.push(args.card);
    const prefs = { ...(lens.prefs || {}), [args.agentId]: { pinned, muted, by: actor.agent, at: Date.now() } };
    await ctx.db.patch(row._id, { data: { ...row.data, lens: { ...lens, prefs } } });
    return { card: args.card, pref: args.pref };
  },
});

// People stay in control of the plan: status changes from the card bump the version,
// so an agent holding an older copy must re-read before it can write.
export const setStep = mutation({
  args: { ...scope, nodeKey: v.string(), stepId: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await access(ctx, args.token, args.boardId, true);
    const user = await ctx.db.get(userId);
    const { row } = await boardPlanCard(ctx, args.boardId, args.nodeKey);
    const node = materialize(row);
    if (!structured(node)) throw new PlanError('This plan was edited as text and can no longer be updated here.');
    if (!node.plan.steps.some((step: Step) => step.id === args.stepId)) throw new PlanError('That step is no longer in the plan.');
    const steps = node.plan.steps.filter((step: Step) => !step.archived).map((step: Step) => step.id === args.stepId ? { ...step, status: args.status } : step);
    return savePlan(ctx, { boardId: args.boardId, userId, agent: user?.name || 'A teammate' }, {
      key: row.key, goal: node.plan.goal, steps, expectedVersion: row.textVersion, shared: true, byPerson: true,
    });
  },
});

// Put every card back in its lane, including ones a person moved by hand.
export const tidy = mutation({
  args: { ...scope, nodeKey: v.string() },
  handler: async (ctx, args) => {
    await access(ctx, args.token, args.boardId, true);
    const { row, rows } = await boardPlanCard(ctx, args.boardId, args.nodeKey);
    for (const member of rows) {
      if (member.data.lane?.plan === row.key && member.data.lane.pinned) {
        await ctx.db.patch(member._id, { data: { ...member.data, lane: { ...member.data.lane, pinned: false } } });
      }
    }
    await relayout(ctx, args.boardId, row.key);
    await ctx.db.patch(args.boardId, { updatedAt: Date.now() });
    return { id: row.key };
  },
});

async function boardPlanCard(ctx: any, boardId: string, nodeKey: string) {
  const rows = await liveRows(ctx, boardId);
  const row = rows.find((candidate: any) => candidate.key === nodeKey && candidate.data.visualPlan && candidate.data.plan);
  if (!row) throw new PlanError('Plan not found on this board.');
  return { row, rows };
}

// A card dragged away from its lane stays where the person put it. Moving the plan
// card carries its lanes along, so that is not a pin.
export async function pinMovedCards(ctx: any, boardId: string, changes: any[]) {
  const moved = changes.filter(change => Number.isFinite(change?.patch?.x) || Number.isFinite(change?.patch?.y));
  if (!moved.length) return new Set<string>();
  const deltas = new Map<string, { dx: number; dy: number; lane: any }>();
  for (const change of moved) {
    const row = await ctx.db.query('nodes').withIndex('board_key', (q: any) => q.eq('boardId', boardId).eq('key', change.id)).unique();
    if (!row || row.deleted) continue;
    deltas.set(change.id, {
      dx: (change.patch.x ?? row.data.x) - row.data.x, dy: (change.patch.y ?? row.data.y) - row.data.y, lane: row.data.lane,
    });
  }
  const pinned = new Set<string>();
  for (const [key, delta] of deltas) {
    if (!delta.lane?.plan || delta.lane.pinned || (!delta.dx && !delta.dy)) continue;
    // Carried along by its plan, or by the card it supports: still laid out automatically.
    const carried = [delta.lane.plan, delta.lane.parent].some(owner => {
      const move = owner ? deltas.get(owner) : null;
      return !!move && Math.abs(move.dx - delta.dx) <= 0.5 && Math.abs(move.dy - delta.dy) <= 0.5;
    });
    if (!carried) pinned.add(key);
  }
  return pinned;
}

// Older MCP clients send free-form notes. Keep the canvas short anyway: the first
// sentence becomes the card and the full text stays one click away and in Context.
export function structureNote(title: string, content: string) {
  const match = title.match(/^(decision|finding|open question|question|risk)\s*[:—–-]\s*(.+)$/i);
  const label = match ? match[1].toLowerCase() : '';
  const kind = label.includes('question') ? 'question' : label || 'note';
  const heading = clip((match ? match[2] : title).trim(), LIMITS.title);
  const text = content.trim();
  const opening = text.split(/\n\s*\n/)[0].replace(/\s+/g, ' ');
  const summary = clip(opening.split(/(?<=[.!?])\s/)[0] || heading, LIMITS.summary);
  return { kind, title: heading, summary, points: [] as string[], detail: text.replace(/\s+/g, ' ') === summary ? '' : text };
}

export async function saveLegacyCard(ctx: any, actor: Actor,
  input: { key: string; kind: 'note' | 'website'; title: string; content: string; url: string; sourceIds: string[] }) {
  const rows = await liveRows(ctx, actor.boardId);
  const board = (await boardPlan(ctx, actor.boardId)).row;
  const waiting: Record<string, any> = board?.data.plan.waiting || {};
  const linked = input.sourceIds.filter(source => !waiting[source]).map(source => {
    const row = rows.find((candidate: any) => candidate.key === source);
    if (!row) throw new PlanError('Source card not found');
    if (!['plan', 'web', 'media', 'upload'].includes(row.data.type)) throw new PlanError('Connect a note, website, video or file source');
    return row;
  });
  const plan = linked.find((row: any) => row.data.visualPlan && row.data.plan);
  if (input.kind === 'website') {
    const existing = rows.find((candidate: any) => candidate.key === input.key);
    if (existing && existing.createdBy !== actor.userId) throw new PlanError('Card ID unavailable. Use a new ID.');
    if (waiting[input.key]) return { id: input.key, added: false };
    return saveSource(ctx, actor, {
      url: input.url, title: clip(input.title, LIMITS.sourceTitle), note: clip(input.content.replace(/\s+/g, ' ').trim(), LIMITS.sourceNote),
      planKey: plan?.key,
    }, { key: input.key, body: input.content });
  }
  const nodes = rows.map(materialize);
  const notes = linked.filter((row: any) => row.data.type === 'plan' && row !== plan);
  const cited = input.sourceIds.filter(source => waiting[source]).map(source => waiting[source])
    .map(item => item.kind === 'file' ? { file: { name: item.title, text: item.text }, note: item.note } : { url: item.url, title: item.title, note: item.note });
  const floating = plan && plan.data.plan.format !== 2;
  return saveCard(ctx, actor, {
    ...structureNote(input.title, input.content), key: input.key, planKey: plan?.key, detailLimit: 24000,
    sources: [...cited, ...linked.filter((row: any) => row.data.type !== 'plan').map((row: any) => ({ cardId: row.key })),
      ...(floating ? [] : notes.map((row: any) => ({ cardId: row.key })))],
    contexts: floating ? notes.map((row: any) => ({ id: input.key + '-' + row.key, ...snapshotNode(nodes.find((node: any) => node.id === row.key), nodes) })) : [],
  });
}

// ---- The board (format 2) ---------------------------------------------------------
// One plan card that builds down and out. Cards live inside their step, sources are
// chips on their card, and nothing an agent writes chooses a position.

const boardOf = (node: any) => !!node && structured(node) && node.plan.format === 2;
const cardRow = (rows: any[], key: unknown) => rows.find((row: any) => row.key === key && row.data.brief && !row.data.visualPlan);

// A source is data on its card: a website, a video or a file. A card already on the
// board becomes a "see also" reference instead.
function sourceFrom(spec: any, rows: any[]): { source?: any; ref?: string } {
  if (!spec || typeof spec !== 'object') throw fail('Each source needs a url, a file, or the cardId of a card already on the board.');
  const note = line(spec.note, 'Source note', LIMITS.sourceNote, false);
  if (spec.cardId) {
    const row = rows.find((candidate: any) => candidate.key === spec.cardId);
    if (!row) throw fail(`Source card "${String(spec.cardId).slice(0, 60)}" is not on this board.`);
    if (row.data.type === 'plan') return { ref: row.key };
    const node = materialize(row);
    return { source: { kind: sourceKind(node), title: node.title, ...(sourceAddress(node) ? { url: sourceAddress(node) } : {}), ...(note ? { note } : {}), card: row.key } };
  }
  if (spec.file) {
    return { source: { kind: 'file', title: line(spec.file.name, 'File name', LIMITS.sourceTitle), text: block(spec.file.text, 'File text', LIMITS.fileText), ...(note ? { note } : {}) } };
  }
  const url = publicUrl(spec.url), video = videoId(url.href);
  const title = line(spec.title, 'Source title', LIMITS.sourceTitle, false);
  return { source: {
    kind: video ? 'video' : 'website', url: video ? 'https://www.youtube.com/watch?v=' + video : url.href,
    title: title || (video ? 'YouTube video' : url.hostname.replace(/^www\./, '')), ...(note ? { note } : {}),
  } };
}
const sameSource = (a: any, b: any) => a.kind === b.kind && (a.url ? a.url === b.url : a.title === b.title && a.text === b.text);
function mergeSources(existing: any[], specs: any[], rows: any[]) {
  const sources = existing.filter(item => item && typeof item === 'object'), refs: string[] = [];
  for (const spec of specs) {
    const { source, ref } = sourceFrom(spec, rows);
    if (ref && !refs.includes(ref)) refs.push(ref);
    if (source && !sources.some(item => sameSource(item, source))) sources.push(source);
  }
  if (sources.length > LIMITS.sources) throw fail(`A card holds at most ${LIMITS.sources} sources. Keep the strongest ones.`);
  return { sources, refs };
}
const sourceLines = (sources: any[]) => sources.length
  ? '**Sources**\n' + sources.map(item => `- ${item.title}${item.url ? ' — ' + item.url : ''}${item.note ? ' (' + item.note + ')' : ''}`).join('\n') : '';

// Files a card is about, as paths in the project, so an agent editing them is sent the card.
function cleanFiles(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > LIMITS.files) throw fail(`files must be a list of at most ${LIMITS.files} paths.`);
  const paths = value.map((raw, index) => {
    const path = line(raw, `File ${index + 1}`, LIMITS.path).replace(/^\.\//, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.split('/').includes('..')) {
      throw fail('List files as paths inside the project, like src/sync/merge.ts. Put links under "sources".');
    }
    return path;
  });
  return [...new Set(paths)];
}
// Links between cards, each with a short reason that people and agents read.
function cleanLinks(value: unknown, rows: any[], self: string): { card: string; why?: string }[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > LIMITS.links) throw fail(`related must be a list of at most ${LIMITS.links} cards.`);
  const links: { card: string; why?: string }[] = [];
  for (const item of value) {
    const id = String(item?.cardId ?? '');
    const row = cardRow(rows, id) || cardRow(rows, 'mcp-' + id);
    if (!row) throw fail(`Related card "${id.slice(0, 60)}" is not on this board. Use a card id from get_brief.`);
    if (row.key === self || links.some(link => link.card === row.key)) continue;
    const why = line(item.why, 'Related reason', LIMITS.linkWhy, false);
    links.push({ card: row.key, ...(why ? { why } : {}) });
  }
  return links;
}
const linkLines = (files: string[], links: { card: string; why?: string }[], rows: any[]) => [
  files.length ? '**Files**\n' + files.map(file => '- `' + file + '`').join('\n') : '',
  links.length ? '**Related**\n' + links.map(link => {
    const row = rows.find((candidate: any) => candidate.key === link.card);
    return `- ${row ? materialize(row).title : link.card}${link.why ? ' — ' + link.why : ''}`;
  }).join('\n') : '',
].filter(Boolean).join('\n\n');

async function writeCardText(ctx: any, row: any, title: string, body: string, data: any, userId: string) {
  const doc = loadDocument(row.textState);
  try {
    doc.transact(() => {
      for (const [field, value] of [['title', title], ['body', body]] as const) {
        const text = doc.getText(field);
        if (text.toString() === value) continue;
        text.delete(0, text.length); text.insert(0, value);
      }
    });
    await ctx.db.patch(row._id, { data, textState: encodeDocument(doc), textVersion: row.textVersion + 1, updatedBy: userId });
  } finally { doc.destroy(); }
}

async function closeCards(ctx: any, actor: Actor, rows: any[], planKey: string, ids: unknown, by: { key: string; kind: string }) {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > 8) throw fail('replaces must be a short list of card ids.');
  const closed: string[] = [];
  for (const id of ids) {
    const row = cardRow(rows, id) || cardRow(rows, 'mcp-' + id);
    if (!row || row.data.lane?.plan !== planKey) throw fail(`Card "${String(id).slice(0, 60)}" is not on this plan, so it cannot be replaced.`);
    const reason = by.kind === 'decision' && row.data.brief.kind === 'question' ? 'answered' : 'superseded';
    await ctx.db.patch(row._id, { data: { ...row.data, brief: { ...row.data.brief, closed: { at: Date.now(), by: actor.agent, reason, card: by.key } } } });
    closed.push(row.key);
  }
  return closed;
}

export async function saveCard(ctx: any, actor: Actor, input: CardInput) {
  const { row: planRow, rows } = await boardPlan(ctx, actor.boardId, input.planKey);
  const planNode = planRow ? materialize(planRow) : null;
  // Plans laid out the older way keep their layout until someone organizes them.
  if (planNode && structured(planNode) && planNode.plan.format !== 2) return saveFloatingCard(ctx, actor, input);
  if (!KINDS.includes(input.kind)) throw fail('kind must be one of ' + KINDS.join(', ') + '.');
  const title = line(input.title, 'Title', LIMITS.title);
  const summary = line(input.summary, 'Summary', LIMITS.summary);
  if (input.points !== undefined && !Array.isArray(input.points)) throw fail('points must be a list of short lines.');
  const points = (input.points || []).map((point: unknown, index: number) => line(point, `Point ${index + 1}`, LIMITS.point));
  if (points.length > LIMITS.points) throw fail(`Use at most ${LIMITS.points} points. Move the rest into "detail".`);
  const detail = block(input.detail, 'Detail', input.detailLimit || LIMITS.detail, false);
  if (input.sources !== undefined && !Array.isArray(input.sources)) throw fail('sources must be a list.');
  const existing = await ctx.db.query('nodes').withIndex('board_key', (q: any) => q.eq('boardId', actor.boardId).eq('key', input.key)).unique();
  if (existing) {
    if (existing.deleted || existing.createdBy !== actor.userId) throw new PlanError('Card ID unavailable. Use a new ID.');
    return { id: input.key, created: false };
  }
  const onBoard = boardOf(planNode);
  const step = onBoard ? resolveStep(planNode.plan, input.step) : null;
  const replaces = (Array.isArray(input.replaces) ? input.replaces : []).flatMap(id => [String(id), 'mcp-' + id]);
  if (onBoard) {
    const stepTitle = step ? planNode.plan.steps.find((candidate: Step) => candidate.id === step).title : 'Unsorted';
    const open = rows.filter((row: any) => row.data.lane?.plan === planRow.key && row.data.brief && !row.data.visualPlan
      && (row.data.brief.step || null) === step && !row.data.brief.closed && !replaces.includes(row.key));
    // One card per topic: revise what exists instead of adding beside it.
    const twin = open.find((row: any) => shape.similarity(materialize(row).title, title) >= 0.6);
    if (twin) throw fail(`This step already has a card on that topic: "${clip(materialize(twin).title, 50)}" (${twin.key}). Revise it with revise_card, or pass replaces: ["${twin.key}"].`);
  }
  const now = Date.now();
  const { sources, refs } = mergeSources([], input.sources || [], rows);
  const files = cleanFiles(input.files) || [], links = cleanLinks(input.related, rows, input.key) || [];
  const agentId = (await contextConnection(ctx, actor))?._id;
  const brief: any = {
    kind: input.kind, summary, points, step, text: '', ...(detail ? { detail } : {}), by: actor.agent, at: now, rev: 1,
    sources, ...(refs.length ? { refs } : {}), ...(files.length ? { files } : {}), ...(links.length ? { links } : {}), ...(agentId ? { agentId } : {}),
  };
  brief.text = shape.cardText(brief);
  const data = {
    id: input.key, type: 'plan', title, body: brief.text, x: planNode?.x || 0, y: planNode?.y || 0, width: SIZE.card, revision: 1,
    titleEdited: true, author: actor.agent, brief, contexts: input.contexts || [],
    ...(onBoard ? { lane: { plan: planRow.key, role: 'card', seq: nextSequence(rows, planRow.key) } } : { layoutHeight: shape.cardHeight(brief) + 40 }),
  };
  await ctx.db.insert('nodes', {
    boardId: actor.boardId, key: input.key, data, textState: initialDocument(data), textVersion: 0,
    createdBy: actor.userId, updatedBy: actor.userId, deleted: false,
  });
  const closed = onBoard ? await closeCards(ctx, actor, rows, planRow.key, input.replaces, { key: input.key, kind: input.kind }) : [];
  if (!onBoard) await placeLoose(ctx, actor.boardId, input.key, SIZE.card, shape.cardHeight(brief) + 40);
  else if (!step) await syncStepCards(ctx, actor, planRow.key);
  await ctx.db.patch(actor.boardId, { updatedAt: now });
  const stepTitle = step ? planNode.plan.steps.find((candidate: Step) => candidate.id === step)?.title : '';
  await logContext(ctx, actor, {
    key: `card:${input.key}`, title: `${KIND_LABEL[input.kind]}: ${title}`, nodeKey: input.key,
    result: [summary, points.map((point: string) => '- ' + point).join('\n'), detail, sourceLines(sources), linkLines(files, links, rows), stepTitle ? `_Plan step: ${stepTitle}_` : ''].filter(Boolean).join('\n\n'),
  });
  return {
    id: input.key, created: true, kind: input.kind, step, sources: sources.length, ...(closed.length ? { replaced: closed } : {}),
    ...(links.length ? { related: links.length } : {}),
    ...(planRow ? { plan: { id: planRow.key, version: planRow.textVersion } } : {}),
  };
}

// Revising a card keeps who wrote each earlier version, whether a person or an agent.
type CardEdit = { key: string; title?: string; summary?: string; points?: any; detail?: string; sources?: any[]; step?: unknown; expectedRevision?: number; byPerson?: boolean; reopen?: boolean; files?: unknown; related?: unknown };
export async function updateCard(ctx: any, actor: Actor, input: CardEdit) {
  const rows = await liveRows(ctx, actor.boardId);
  const row = cardRow(rows, input.key);
  if (!row) throw fail('That card is not on this board. Call get_brief for current card ids.');
  const node = materialize(row), brief = node.brief, revision = brief.rev || 1;
  if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
    throw new PlanError(`Card changed (now revision ${revision}). Read it again with read_card, merge your change, and retry.`);
  }
  const editors = await ctx.db.query('editors').withIndex('node', (q: any) => q.eq('boardId', actor.boardId).eq('nodeKey', row.key)).collect();
  if (editors.some((editor: any) => editor.expiresAt > Date.now())) throw new PlanError('Someone is editing this card. Try again after they finish.');
  const title = input.title === undefined ? node.title : line(input.title, 'Title', LIMITS.title);
  const summary = input.summary === undefined ? brief.summary : line(input.summary, 'Summary', LIMITS.summary);
  if (input.points !== undefined && !Array.isArray(input.points)) throw fail('points must be a list of short lines.');
  const points = input.points === undefined ? brief.points || [] : input.points.map((point: unknown, index: number) => line(point, `Point ${index + 1}`, LIMITS.point));
  if (points.length > LIMITS.points) throw fail(`Use at most ${LIMITS.points} points. Move the rest into "detail".`);
  const detail = input.detail === undefined ? brief.detail || '' : block(input.detail, 'Detail', LIMITS.detail, false);
  const planRow = rows.find((candidate: any) => candidate.key === node.lane?.plan);
  const planNode = planRow ? materialize(planRow) : null;
  const step = input.step === undefined || !boardOf(planNode) ? brief.step || null : resolveStep(planNode.plan, input.step);
  const merged = input.sources ? mergeSources(brief.sources || [], input.sources, rows) : { sources: brief.sources || [], refs: [] as string[] };
  const refs = [...new Set([...(brief.refs || []), ...merged.refs])];
  const files = cleanFiles(input.files) ?? brief.files ?? [];
  // New links replace an older link to the same card; the rest are kept.
  const added = cleanLinks(input.related, rows, row.key) || [];
  const links = [...(brief.links || []).filter((link: any) => !added.some(item => item.card === link.card)), ...added];
  const linked = JSON.stringify(files) !== JSON.stringify(brief.files || []) || JSON.stringify(links) !== JSON.stringify(brief.links || []);
  const now = Date.now();
  // What a person typed straight into the card is kept as its own earlier version.
  const typed = node.body !== brief.text;
  const earlier = {
    at: brief.editedAt || brief.at, by: typed ? 'Edited by hand' : brief.editedBy || brief.by, ...(brief.editedByPerson || typed ? { person: true } : {}),
    title: node.title, summary: typed ? node.body : brief.summary, points: typed ? [] : brief.points || [],
  };
  const changed = title !== node.title || summary !== brief.summary || JSON.stringify(points) !== JSON.stringify(brief.points || []) || typed;
  const moved = step !== (brief.step || null);
  if (!changed && !moved && !linked && detail === (brief.detail || '') && merged.sources.length === (brief.sources || []).length && !input.reopen) return { id: row.key, revision, changed: false };
  const next: any = {
    ...brief, summary, points, step, sources: merged.sources, ...(refs.length ? { refs } : {}), rev: revision + 1,
    editedAt: now, editedBy: actor.agent, editedByPerson: !!input.byPerson,
    history: changed ? [earlier, ...(brief.history || [])].slice(0, BUDGET.history) : brief.history || [],
  };
  if (detail) next.detail = detail; else delete next.detail;
  if (files.length) next.files = files; else delete next.files;
  if (links.length) next.links = links; else delete next.links;
  if (input.reopen) delete next.closed;
  next.text = shape.cardText(next);
  await writeCardText(ctx, row, title, next.text, { ...row.data, title, body: next.text, brief: next }, actor.userId);
  if (moved && planRow) await syncStepCards(ctx, actor, planRow.key);
  await ctx.db.patch(actor.boardId, { updatedAt: now });
  if (!input.byPerson) {
    await logContext(ctx, actor, {
      key: `card:${row.key}:${revision + 1}`, title: `Updated ${KIND_LABEL[brief.kind].toLowerCase()}: ${title}`, nodeKey: row.key,
      result: [summary, points.map((point: string) => '- ' + point).join('\n'), input.detail === undefined ? '' : detail, sourceLines(merged.sources), linked ? linkLines(files, links, rows) : ''].filter(Boolean).join('\n\n'),
    });
  }
  return { id: row.key, revision: revision + 1, changed: true, step };
}

// Research that supports the work but does not earn a place on the canvas.
export async function logResearch(ctx: any, actor: Actor, input: { title: string; detail: string; step?: unknown }) {
  const title = line(input.title, 'Title', 120), detail = block(input.detail, 'Detail', LIMITS.detail);
  const id = await logContext(ctx, actor, { key: 'research:' + (await hashed(title, detail)), title: 'Research: ' + title, result: detail });
  return { logged: !!id };
}

export async function saveSource(ctx: any, actor: Actor, input: SourceInput, legacy?: { key: string; body: string }) {
  const { row: planRow, rows } = await boardPlan(ctx, actor.boardId, input.planKey);
  const planNode = planRow ? materialize(planRow) : null;
  if (planNode && structured(planNode) && planNode.plan.format !== 2) return saveFloatingSource(ctx, actor, input, legacy);
  if (legacy && !boardOf(planNode)) return saveFloatingSource(ctx, actor, input, legacy);
  const { source } = sourceFrom(input, rows);
  if (!source) throw fail('Add a url or a file. To link two cards, list the other card under "sources" with its cardId.');
  if (input.forCard) {
    const parent = cardRow(rows, input.forCard);
    if (!parent) throw fail(`Card "${String(input.forCard).slice(0, 60)}" is not on this board.`);
    const current = (parent.data.brief.sources || []).filter((item: any) => item && typeof item === 'object');
    if (current.some((item: any) => sameSource(item, source))) return { added: false, card: parent.key };
    if (current.length >= LIMITS.sources) throw fail(`That card already has ${LIMITS.sources} sources. Keep the strongest ones.`);
    await ctx.db.patch(parent._id, { data: { ...parent.data, brief: { ...parent.data.brief, sources: [...current, source] } } });
    await ctx.db.patch(actor.boardId, { updatedAt: Date.now() });
    return { added: true, card: parent.key, kind: source.kind, title: source.title };
  }
  if (!boardOf(planNode)) throw fail('Say which card this source supports with "forCard".');
  // Older clients add a website first and cite it from a note afterwards.
  const step = legacy ? null : resolveStep(planNode.plan, input.step);
  if (!step && !legacy) throw fail('Say which card ("forCard") or plan step ("step") this source supports.');
  const plan = { ...planRow.data.plan };
  if (legacy) plan.waiting = { ...(plan.waiting || {}), [legacy.key]: source };
  else plan.steps = plan.steps.map((item: Step) => item.id !== step ? item
    : { ...item, sources: (item.sources || []).some((old: any) => sameSource(old, source)) ? item.sources : [...(item.sources || []), source].slice(-LIMITS.sources) });
  await ctx.db.patch(planRow._id, { data: { ...planRow.data, plan } });
  await ctx.db.patch(actor.boardId, { updatedAt: Date.now() });
  return { id: legacy?.key, added: true, step, kind: source.kind, title: source.title };
}

// Pulling a card out puts it on the open canvas as its own card; putting it back
// returns it to its step.
export async function setPulledOut(ctx: any, boardId: string, key: string, out: boolean) {
  const rows = await liveRows(ctx, boardId);
  const row = rows.find((candidate: any) => candidate.key === key && candidate.data.lane?.plan && !candidate.data.visualPlan);
  const planRow = row && rows.find((candidate: any) => candidate.key === row.data.lane?.plan);
  if (!row || !planRow) throw new PlanError('That card is not part of a plan.');
  let location = {};
  if (out) {
    const plan = planRow.data;
    location = place(rows.filter((other: any) => other.key !== key && !(other.data.lane?.plan === planRow.key && !other.data.lane.pinned)).map((other: any) => other.data),
      { x: plan.x + (plan.width || SIZE.plan) + 80, y: plan.y }, SIZE.card, 320);
  }
  await ctx.db.patch(row._id, { data: { ...row.data, ...location, lane: { ...row.data.lane, pinned: out } } });
  await ctx.db.patch(boardId, { updatedAt: Date.now() });
  return { id: key, pulledOut: out };
}

// Organize restores the rules without touching anyone's words: cards go back to a
// step, sources become chips on their card, and the plan becomes one board. Every
// card it changes is saved first so the whole thing can be undone.
const undoKey = (planKey: string) => 'undo-' + planKey;
export async function organize(ctx: any, actor: Actor, nodeKey: string, apply: boolean, options: { byAgent?: boolean } = {}) {
  const { row: planRow, rows } = await boardPlanCard(ctx, actor.boardId, nodeKey);
  const planNode = materialize(planRow);
  if (!structured(planNode)) throw new PlanError('This plan was edited as text, so it cannot be organized automatically.');
  const before = shape.health(planNode, rows.map(materialize));
  const saved = new Map<string, any>();
  const edits = new Map<string, any>();
  const edit = (row: any, change: (data: any) => any) => {
    if (!saved.has(row.key)) saved.set(row.key, row.data);
    edits.set(row.key, { row, data: change(edits.get(row.key)?.data || row.data) });
  };
  const removed: any[] = [];
  const plan: Plan & { sources?: any[] } = { ...planRow.data.plan, steps: planRow.data.plan.steps.map((step: Step) => ({ ...step })) };
  const live = plan.steps.filter(step => !step.archived);
  const members = rows.filter((row: any) => row.data.lane?.plan === planRow.key);
  const actions: { text: string; count: number }[] = [];
  const act = (count: number, one: string, many = one) => { if (count) actions.push({ count, text: count === 1 ? one : many }); };

  // Sources that are separate cards become chips on the card, or step, they support.
  const sourceRows = members.filter((row: any) => row.data.lane.role === 'source');
  const chips = new Map<string, any[]>();
  for (const row of sourceRows) {
    const node = materialize(row);
    const chip = {
      kind: sourceKind(node), title: node.title, ...(sourceAddress(node) ? { url: sourceAddress(node) } : {}),
      ...(node.sourceNote ? { note: node.sourceNote } : {}), ...(node.type === 'upload' && node.text ? { text: node.text } : {}),
    };
    const parent = cardRow(rows, row.data.lane.parent);
    if (parent) chips.set(parent.key, [...(chips.get(parent.key) || []), chip]);
    else {
      const step = live.find(item => item.id === row.data.lane.step);
      if (step) step.sources = [...(step.sources || []), chip];
      else plan.sources = [...(plan.sources || []), chip];
    }
    if (!saved.has(row.key)) saved.set(row.key, row.data);
    removed.push(row);
  }
  act(sourceRows.length, 'source card becomes a chip on the card it supports', 'source cards become chips on the card they support');

  let rehomed = 0, unsorted = 0, pulled = 0;
  for (const row of members.filter((candidate: any) => candidate.data.lane.role === 'step' && candidate.data.lane.pinned)) {
    pulled++;
    edit(row, data => ({ ...data, lane: { ...data.lane, pinned: false } }));
  }
  for (const row of members.filter((candidate: any) => candidate.data.lane.role === 'card' && candidate.data.brief)) {
    const brief = row.data.brief;
    let step = brief.step || null;
    if (step && !plan.steps.some(item => item.id === step)) {
      // The old step id is the old title in short form; file the card under the closest current step.
      const named = live.map(item => ({ item, score: shape.similarity(String(step).replace(/-/g, ' '), item.title) })).sort((a, b) => b.score - a.score)[0];
      // Otherwise go by what the card is about: the step whose title and note share the most words with it.
      const about = materialize(row);
      const topical = live.map(item => ({ item, score: shape.sharedWords(about.title + ' ' + about.body, item.title + ' ' + item.note) })).sort((a, b) => b.score - a.score)[0];
      step = named && named.score >= 0.5 ? named.item.id : topical && topical.score >= 2 ? topical.item.id : null;
      if (step) rehomed++; else unsorted++;
    }
    const mine = [...(brief.sources || []).filter((item: any) => item && typeof item === 'object'), ...(chips.get(row.key) || [])];
    const sources = mine.filter((item, index) => mine.findIndex(other => sameSource(other, item)) === index);
    const dropped = new Set(sourceRows.map((source: any) => source.key));
    const refs = (row.data.contexts || []).filter((context: any) => !dropped.has(context.source) && context.source !== planRow.key && cardRow(rows, context.source)).map((context: any) => context.source);
    if (row.data.lane.pinned) pulled++;
    const changedCard = step !== (brief.step || null) || row.data.lane.pinned || (row.data.contexts || []).length || sources.length !== (brief.sources || []).length
      || (brief.sources || []).some((item: any) => typeof item !== 'object');
    if (!changedCard) continue;
    edit(row, data => ({
      ...data, contexts: [], x: planRow.data.x, y: planRow.data.y, lane: { ...data.lane, pinned: false },
      brief: { ...data.brief, step, sources, ...(refs.length ? { refs: [...new Set([...(data.brief.refs || []), ...refs])] } : {}) },
    }));
  }
  act(rehomed, 'card whose step was removed goes to the current step it is about', 'cards whose step was removed go to the current step they are about');
  act(unsorted, 'card whose step was removed goes to Unsorted', 'cards whose step was removed go to Unsorted');
  act(pulled, 'card moved by hand returns to its place', 'cards moved by hand return to their place');
  act(plan.format === 2 ? 0 : 1, 'plan is laid out as steps in a row with their cards beneath');
  if (!apply) return { applied: false, health: before, actions };
  if (!actions.length) return { applied: false, health: before, actions, nothingToDo: true };

  const now = Date.now(), user = await ctx.db.get(actor.userId);
  for (const { row, data } of edits.values()) await ctx.db.patch(row._id, { data });
  for (const row of removed) await ctx.db.patch(row._id, { deleted: true });
  plan.format = 2; plan.revision = (plan.revision || 0) + 1; plan.updatedAt = now; plan.updatedBy = actor.agent;
  plan.log = [{ at: now, ...(options.byAgent ? { by: actor.agent } : { by: user?.name || actor.agent, person: true }), text: clip('Organized the board: ' + actions.map(item => `${item.count} ${item.text}`).join('; '), 280) }, ...(plan.log || [])].slice(0, BUDGET.log);
  const body = shape.planText(plan);
  // The saved copy lives in a hidden record, so it is never sent to anyone's browser.
  const payload = { planKey: planRow.key, at: now, plan: planRow.data, nodes: [...saved].map(([key, data]) => ({ key, data })), removed: removed.map(row => row.key) };
  const old = await ctx.db.query('nodes').withIndex('board_key', (q: any) => q.eq('boardId', actor.boardId).eq('key', undoKey(planRow.key))).unique();
  const record = { id: undoKey(planRow.key), type: 'plan', title: 'Organize undo', body: '', x: 0, y: 0, undo: payload };
  if (old) await ctx.db.patch(old._id, { data: record, deleted: true });
  else await ctx.db.insert('nodes', { boardId: actor.boardId, key: record.id, data: record, textState: initialDocument(record), textVersion: 0, createdBy: actor.userId, updatedBy: actor.userId, deleted: true });
  await writeCardText(ctx, planRow, planRow.data.title, body, { ...planRow.data, plan, planBody: body, body, width: SIZE.plan, canUndoOrganize: now }, actor.userId);
  await syncStepCards(ctx, actor, planRow.key);
  await ctx.db.patch(actor.boardId, { updatedAt: now });
  const after = await liveRows(ctx, actor.boardId);
  return { applied: true, actions, health: shape.health({ ...planNode, plan }, after.map(materialize)) };
}

export async function undoOrganize(ctx: any, actor: Actor, nodeKey: string) {
  const record = await ctx.db.query('nodes').withIndex('board_key', (q: any) => q.eq('boardId', actor.boardId).eq('key', undoKey(nodeKey))).unique();
  const undo = record?.data?.undo;
  if (!undo) throw new PlanError('There is nothing to undo.');
  const all = await ctx.db.query('nodes').withIndex('board_key', (q: any) => q.eq('boardId', actor.boardId)).collect();
  for (const item of undo.nodes) {
    const row = all.find((candidate: any) => candidate.key === item.key);
    if (row) await ctx.db.patch(row._id, { data: item.data, deleted: false });
  }
  const planRow = all.find((candidate: any) => candidate.key === nodeKey);
  if (!planRow || planRow.deleted) throw new PlanError('The plan is no longer on this board.');
  const now = Date.now(), user = await ctx.db.get(actor.userId);
  const plan = { ...undo.plan.plan, revision: (planRow.data.plan.revision || 0) + 1, updatedAt: now,
    log: [{ at: now, by: user?.name || actor.agent, person: true, text: 'Undid Organize' }, ...(planRow.data.plan.log || [])].slice(0, BUDGET.log) };
  const body = shape.planText(plan);
  const { canUndoOrganize, ...rest } = undo.plan;
  await writeCardText(ctx, planRow, planRow.data.title, body, { ...rest, plan, planBody: body, body }, actor.userId);
  await ctx.db.patch(record._id, { data: { ...record.data, undo: null } });
  await syncStepCards(ctx, actor, nodeKey);
  if (plan.format !== 2) await relayout(ctx, actor.boardId, nodeKey);
  await ctx.db.patch(actor.boardId, { updatedAt: now });
  return { undone: true };
}

const personActor = async (ctx: any, args: { token: string; boardId: string }) => {
  const { userId } = await access(ctx, args.token, args.boardId, true);
  return { boardId: args.boardId, userId, agent: (await ctx.db.get(userId))?.name || 'A teammate' } as Actor;
};
const editArgs = {
  cardId: v.string(), title: v.optional(v.string()), summary: v.optional(v.string()), points: v.optional(v.array(v.string())),
  detail: v.optional(v.string()), sources: v.optional(v.array(v.any())), step: v.optional(v.union(v.string(), v.number())),
  expectedRevision: v.optional(v.number()), files: v.optional(v.array(v.string())), related: v.optional(v.array(v.any())),
};
// Agents address cards by the id they chose; the stored key carries the "mcp-" prefix.
const keyOf = async (ctx: any, boardId: string, cardId: string) => {
  const rows = await liveRows(ctx, boardId);
  return rows.some((row: any) => row.key === cardId) ? cardId : 'mcp-' + cardId;
};
export const updateCardAsAgent = mutation({
  args: { ...scope, ...agentArg, ...editArgs },
  handler: async (ctx, args) => updateCard(ctx, await actorFor(ctx, args), { ...args, key: await keyOf(ctx, args.boardId, args.cardId) }),
});
export const logResearchNote = mutation({
  args: { ...scope, ...agentArg, title: v.string(), detail: v.string() },
  handler: async (ctx, args) => logResearch(ctx, await actorFor(ctx, args), args),
});
// People edit the same cards from the canvas; their name is kept with each version.
export const editCard = mutation({
  args: { ...scope, nodeKey: v.string(), title: v.optional(v.string()), summary: v.optional(v.string()), points: v.optional(v.array(v.string())), step: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => updateCard(ctx, await personActor(ctx, args), {
    key: args.nodeKey, title: args.title, summary: args.summary, points: args.points, byPerson: true,
    ...(args.step === undefined ? {} : { step: args.step === null ? '' : args.step }),
  }),
});
export const setCardClosed = mutation({
  args: { ...scope, nodeKey: v.string(), closed: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await personActor(ctx, args);
    const rows = await liveRows(ctx, args.boardId), row = cardRow(rows, args.nodeKey);
    if (!row) throw new PlanError('That card is no longer on this board.');
    const brief = { ...row.data.brief };
    if (args.closed) brief.closed = { at: Date.now(), by: actor.agent, person: true, reason: 'closed' }; else delete brief.closed;
    await ctx.db.patch(row._id, { data: { ...row.data, brief } });
    await ctx.db.patch(args.boardId, { updatedAt: Date.now() });
    return { id: row.key, closed: args.closed };
  },
});
export const pullOut = mutation({
  args: { ...scope, nodeKey: v.string(), out: v.boolean() },
  handler: async (ctx, args) => { await access(ctx, args.token, args.boardId, true); return setPulledOut(ctx, args.boardId, args.nodeKey, args.out); },
});
export const organizeBoard = mutation({
  args: { ...scope, nodeKey: v.string(), apply: v.boolean() },
  handler: async (ctx, args) => organize(ctx, await personActor(ctx, args), args.nodeKey, args.apply),
});
export const undoOrganizeBoard = mutation({
  args: { ...scope, nodeKey: v.string() },
  handler: async (ctx, args) => undoOrganize(ctx, await personActor(ctx, args), args.nodeKey),
});
