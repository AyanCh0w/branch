import { afterAll, beforeAll, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { harness } from './harness';
import { boardAgentRequest } from '../board-agent-http';
import { createServer } from '../../mcp/server.cjs';
import * as shape from '../../app/plan-layout.js';

let h: Awaited<ReturnType<typeof harness>>;
let alex: Awaited<ReturnType<typeof h.account>>;
let eric: typeof alex;
let boardId: string;
const scope = () => ({ boardId, token: '' });
const read = async (id = boardId) => (await h.call(alex, 'boards:read', { boardId: id, token: '' }, 'query')).nodes as any[];
const planOf = (nodes: any[]) => nodes.find(node => node.visualPlan);
const healthOf = (nodes: any[]) => shape.health(planOf(nodes), nodes);

beforeAll(async () => {
  h = await harness();
  alex = await h.account('alex');
  eric = await h.account('eric');
  boardId = await h.call(alex, 'library:create', { title: 'Taco truck' });
  await h.call(alex, 'sharing:addMember', { boardId, username: 'eric', role: 'editor' });
});
afterAll(() => h?.close());

async function parse(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = (result.content as Array<{ type: string; text: string }>)[0];
  if (result.isError) throw new Error(content.text);
  return JSON.parse(content.text);
}

// The local MCP server, signed in as a person, with the backend called in process.
async function localAgent(person: typeof alex, clientName: string) {
  const backend = {
    query: (name: string, args = {}) => h.call(person, name, args, 'query'),
    mutation: (name: string, args = {}) => h.call(person, name, args, 'mutation'),
  };
  const server = createServer(backend, 'http://127.0.0.1:4387');
  const client = new Client({ name: clientName, version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  return { client, call: (name: string, args: Record<string, unknown> = {}) => parse(client, name, { boardId, ...args }), close: () => client.close() };
}

// A hosted board agent connected with a board key.
async function boardAgent(person: typeof alex, name: string) {
  const grant = await h.call(person, 'boardAgents:connect', { ...scope(), name, mode: 'edit' });
  const client = new Client({ name: 'codex', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4387/api/backend?agent=1'), {
    requestInit: { headers: { Authorization: 'Bearer ' + grant.code } },
    fetch: async (input, init) => boardAgentRequest(new Request(input, init), h.engine),
  }));
  return { client, call: (tool: string, args: Record<string, unknown> = {}) => parse(client, tool, args), close: () => client.close() };
}

const steps = [
  { title: 'Define the concept and menu', status: 'done', note: '6–8 items, one signature taco.' },
  { title: 'Line up private-lot hosts and events', status: 'working', note: 'Next: list 10 hosts.' },
  { title: 'Write the business plan and budget', status: 'pending' },
  { title: 'Get the county health permit', status: 'pending' },
  { title: 'Get the city permits', status: 'pending' },
];

it('builds one board: conclusions on the canvas, research in Context, nothing floating', async () => {
  const claude = await localAgent(alex, 'claude-code');
  try {
    expect((await claude.client.listTools()).tools.map(tool => tool.name)).toEqual(expect.arrayContaining(
      ['get_brief', 'update_plan', 'add_card', 'revise_card', 'record_decision', 'add_source', 'log_research', 'read_context']));
    const created = await claude.call('update_plan', { title: 'Taco truck launch', goal: 'Launch a permitted taco truck in Santa Clara.', steps, expectedVersion: -1 });
    expect(created).toMatchObject({ id: 'plan-main', version: 0 });
    const [menu, hosts, budget, county, city] = created.steps.map((step: any) => step.id);

    // R11: length limits still hold, with an instruction the agent can act on.
    await expect(h.call(alex, 'planning:addCard', { ...scope(), cardId: 'long', kind: 'finding', title: 'Permits', summary: 'x'.repeat(260) }))
      .rejects.toThrow(/limit is 200.*detail/s);

    const finding = await claude.call('add_card', {
      cardId: 'city-approvals', kind: 'finding', step: 5, title: 'Three city approvals',
      summary: 'Santa Clara requires three approvals on top of the county health permit.',
      points: ['Police peddler permit with Livescan', 'Business tax certificate', 'Zoning clearance per private lot'],
      detail: 'SCCC 5.05.020, 3.40 and 18.60.280. The police permit fee is not published.',
      sources: [
        { url: 'https://www.santaclaraca.gov/home/showpublisheddocument/52645/639075417316730000', title: 'Mobile Food Truck Permit Procedures', note: 'City checklist.' },
        { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Permit walkthrough' },
        { file: { name: 'fees.md', text: '# Fees\n\nPolice permit: unknown' } },
      ],
    });
    expect(finding).toMatchObject({ created: true, step: city, sources: 3 });

    // R8: one card per topic. A second card on the same subject is refused with the id to revise.
    await expect(claude.call('add_card', { cardId: 'city-approvals-2', kind: 'finding', step: 5, title: 'City approvals needed', summary: 'Same topic again.' }))
      .rejects.toThrow(/already has a card on that topic.*mcp-city-approvals.*revise_card/s);
    const revised = await claude.call('revise_card', { cardId: 'mcp-city-approvals', summary: 'Santa Clara requires three city approvals; the police permit fee is unpublished.', expectedRevision: 1 });
    expect(revised).toMatchObject({ revision: 2, changed: true });
    await expect(claude.call('revise_card', { cardId: 'city-approvals', summary: 'Stale write.', expectedRevision: 1 })).rejects.toThrow('Card changed (now revision 2)');

    // Nothing caps how much a step holds; raw research can still go straight to Context.
    await claude.call('add_card', { cardId: 'zoning', kind: 'finding', step: 5, title: 'Zoning clearance timing', summary: 'Clearance covers 2–4 hours on a private lot.' });
    await claude.call('add_card', { cardId: 'tax', kind: 'finding', step: 5, title: 'Business tax rate', summary: 'About $46 per employee per year.' });
    expect(await claude.call('add_card', { cardId: 'fourth', kind: 'finding', step: 5, title: 'Fire inspection', summary: 'Fire inspection is separate.' }))
      .toMatchObject({ created: true });
    expect(await claude.call('log_research', { title: 'Fire inspection', detail: 'Read the fire marshal page; inspection is booked after the county permit.' })).toEqual({ logged: true });

    const question = await claude.call('add_card', { cardId: 'street', kind: 'question', step: hosts, title: 'Street vending allowed?', summary: 'Can the truck vend on public streets, or only private lots?' });
    // R5: a decision that answers a question closes it.
    const decision = await claude.call('record_decision', {
      cardId: 'private-lots', step: hosts, title: 'Private lots only', summary: 'Sell on private lots and at events, never on public streets.',
      replaces: [question.id], planChanges: [{ step: 3, status: 'working', note: 'Budget for zoning fees per lot.' }],
      sources: [{ cardId: 'mcp-city-approvals' }],
    });
    expect(decision).toMatchObject({ replaced: ['mcp-street'], planUpdate: { applied: true, version: 1 } });

    // R4: a step that holds cards cannot vanish. The refusal says how to keep its cards.
    const rebuilt = [{ id: hosts, title: 'Secure private lots', status: 'working' }, { title: 'File permits', status: 'pending' }];
    await expect(claude.call('update_plan', { goal: 'Launch on private lots.', steps: rebuilt, expectedVersion: 1 }))
      .rejects.toThrow(/has 4 cards and is missing.*moves/s);
    const moved = await claude.call('update_plan', { goal: 'Launch on private lots.', steps: rebuilt, expectedVersion: 1, moves: { [city]: 'file-permits', [menu]: 'archive' } });
    expect(moved.steps.map((step: any) => step.title)).toEqual(['Secure private lots', 'File permits']);

    const nodes = await read();
    const plan = planOf(nodes);
    expect(plan.plan).toMatchObject({ format: 2 });
    expect(plan.width).toBe(shape.SIZE.plan);
    // Each live step is its own card, so people can move, open and connect it like any other.
    expect(nodes.filter(node => node.stepCard).map(node => [node.title, node.stepCard.step]).sort()).toEqual([['File permits', 'file-permits'], ['Secure private lots', hosts]]);
    // R6 and R9: sources are chips, so the only nodes are the plan and its cards, and none has a place of its own.
    expect(nodes.map(node => node.type)).toEqual(Array(nodes.length).fill('plan'));
    expect(nodes.filter(node => node.lane?.role === 'source')).toEqual([]);
    const card = nodes.find(node => node.id === 'mcp-city-approvals');
    expect(card.brief.sources.map((source: any) => source.kind)).toEqual(['website', 'video', 'file']);
    expect(card.brief).toMatchObject({ step: 'file-permits', rev: 2, history: [expect.objectContaining({ by: 'Claude Code · alex', summary: 'Santa Clara requires three approvals on top of the county health permit.' })] });
    expect(nodes.find(node => node.id === 'mcp-private-lots').brief.refs).toEqual(['mcp-city-approvals']);
    expect(nodes.find(node => node.id === 'mcp-street').brief.closed).toMatchObject({ reason: 'answered', card: 'mcp-private-lots' });
    // The menu step had no cards, so it simply went; nothing is orphaned and the board passes every rule.
    expect(plan.plan.steps.filter((step: any) => step.archived)).toEqual([]);
    expect(healthOf(nodes)).toEqual({ ok: true, issues: [] });
    expect(plan.plan.log[0]).toMatchObject({ by: 'Claude Code · alex', text: expect.stringContaining('Moved 4 cards from “Get the city permits” to “File permits”') });

    // Context has the reasoning and the research that never reached the canvas.
    const sources = await h.call(eric, 'boardAgents:sources', scope(), 'query');
    const timeline = await h.call(eric, 'boardAgents:activity', { ...scope(), connectionId: sources[0].id, limit: 50 }, 'query');
    expect(timeline.items.map((item: any) => item.title)).toEqual(expect.arrayContaining([
      'Plan created: Taco truck launch', 'Finding: Three city approvals', 'Updated finding: Three city approvals', 'Research: Fire inspection', 'Decision: Private lots only',
    ]));
    const brief = await claude.call('get_brief');
    expect(brief.plan.steps[1].cards.map((item: any) => item.title).sort()).toEqual(['Business tax rate', 'Fire inspection', 'Three city approvals', 'Zoning clearance timing']);
    expect(brief.openQuestions).toEqual([]);
    expect(brief.decisions[0]).toMatchObject({ title: 'Private lots only' });
    expect(JSON.stringify(brief).length).toBeLessThan(6000);
    if (process.env.PLAN_BOARD_SNAPSHOT) writeFileSync(process.env.PLAN_BOARD_SNAPSHOT, JSON.stringify({ title: 'Taco truck', nodes }, null, 1));
  } finally { await claude.close(); }
});

it('lets people and teammates’ agents change the same board, keeping who changed what', async () => {
  const codex = await boardAgent(eric, 'Codex · Eric');
  try {
    const before = await codex.call('get_brief');
    const hostsStep = before.plan.steps[0].id;
    // A person changes a step; the agent's older copy is refused.
    await h.call(alex, 'planning:setStep', { ...scope(), nodeKey: 'plan-main', stepId: hostsStep, status: 'blocked' });
    await expect(codex.call('update_plan', { goal: before.plan.goal, steps: before.plan.steps, expectedVersion: before.plan.version })).rejects.toThrow('Plan changed');
    // R13: a person edits an agent's card and an agent edits it again; both versions are kept with names.
    await h.call(alex, 'planning:editCard', { ...scope(), nodeKey: 'mcp-zoning', summary: 'Clearance covers 2–4 hours; over 4 hours needs a Minor Use Permit.' });
    await codex.call('revise_card', { cardId: 'mcp-zoning', title: 'Zoning clearance rules' });
    let nodes = await read();
    const zoning = nodes.find(node => node.id === 'mcp-zoning');
    expect(zoning.brief).toMatchObject({ rev: 3, editedBy: 'Codex · Eric' });
    expect(zoning.brief.history.map((version: any) => [version.by, !!version.person])).toEqual([['alex', true], ['Claude Code · alex', false]]);
    // A teammate's decision lands on the shared plan.
    const decision = await codex.call('record_decision', { requestId: 'used-truck', step: hostsStep, title: 'Buy a used truck', summary: 'Buy a used, already-permitted truck.', planChanges: [{ step: 1, note: 'Used truck only.' }] });
    expect(decision.planUpdate.applied).toBe(true);
    // Pulling a card out puts it on the open canvas; the board notices, and Organize puts it back.
    await h.call(alex, 'planning:pullOut', { ...scope(), nodeKey: decision.id, out: true });
    nodes = await read();
    expect(nodes.find(node => node.id === decision.id).lane.pinned).toBe(true);
    // Dragging a step by hand keeps it where the person put it; moving the plan with it does not.
    const stepCard = nodes.find(node => node.stepCard);
    await h.call(alex, 'boards:patchNodes', { ...scope(), changes: [{ id: stepCard.id, patch: { x: stepCard.x + 900, y: stepCard.y } }] });
    expect((await read()).find(node => node.id === stepCard.id).lane.pinned).toBe(true);
    const preview = await h.call(alex, 'planning:organizeBoard', { ...scope(), nodeKey: 'plan-main', apply: false });
    expect(preview).toMatchObject({ applied: false, actions: [{ count: 2, text: 'cards moved by hand return to their place' }] });
    await h.call(alex, 'planning:organizeBoard', { ...scope(), nodeKey: 'plan-main', apply: true });
    expect((await read()).some(node => node.lane?.pinned)).toBe(false);
    expect(healthOf(await read()).ok).toBe(true);
  } finally { await codex.close(); }
});

it('organizes an older free-floating board without changing a word, and can undo it', async () => {
  const board = await h.call(alex, 'library:create', { title: 'Older layout' });
  const previous = boardId;
  boardId = board;
  const claude = await localAgent(alex, 'claude-code');
  try {
    await claude.call('update_plan', { goal: 'Launch a taco truck.', steps: steps.slice(0, 3), expectedVersion: -1 });
    // Put the plan back in the older layout, the way boards made before this change are stored.
    await h.pool.query(`update branch_private.nodes set data = data #- '{plan,format}' where board_id=$1 and key='plan-main'`, [board]);
    await claude.call('add_card', {
      cardId: 'permits', kind: 'finding', step: 2, title: 'Three approvals', summary: 'Three city approvals are needed.', detail: 'Long reasoning stays intact.',
      sources: [{ url: 'https://example.com/a', title: 'Checklist', note: 'Why it matters.' }, { url: 'https://youtu.be/aqz-KE-bpKQ' }],
    });
    await claude.call('add_card', { cardId: 'costs', kind: 'finding', step: 3, title: 'Costs', summary: 'About $3,600 in county fees.', sources: [{ url: 'https://example.com/b' }] });
    await claude.call('add_source', { file: { name: 'menu.md', text: '# Menu' }, step: 1 });
    // A rebuilt plan left one card pointing at a step that is gone.
    await h.pool.query(`update branch_private.nodes set data = jsonb_set(data, '{brief,step}', '"write-business-plan"') where board_id=$1 and key='mcp-costs'`, [board]);
    const before = await read(board);
    expect(before.filter(node => node.lane?.role === 'source')).toHaveLength(4);
    expect(healthOf(before).issues.map(issue => issue.rule).sort()).toEqual(['format', 'home', 'sources']);
    const words = (nodes: any[]) => nodes.filter(node => node.brief).map(node => [node.id, node.title, node.body, node.brief.detail || '']).sort();

    const preview = await h.call(alex, 'planning:organizeBoard', { boardId: board, token: '', nodeKey: 'plan-main', apply: false });
    expect(preview.actions.map((action: any) => [action.count, action.text])).toEqual([
      [4, 'source cards become chips on the card they support'], [1, 'card whose step was removed goes to the current step it is about'],
      [1, 'plan is laid out as steps in a row with their cards beneath'],
    ]);
    expect(words(await read(board))).toEqual(words(before));
    const applied = await h.call(alex, 'planning:organizeBoard', { boardId: board, token: '', nodeKey: 'plan-main', apply: true });
    expect(applied.health).toEqual({ ok: true, issues: [] });
    const after = await read(board);
    // No text changed; sources are chips; the stray card is back under the matching step.
    expect(words(after)).toEqual(words(before));
    expect(after.filter(node => node.lane?.role === 'source')).toEqual([]);
    expect(after.filter(node => node.stepCard)).toHaveLength(3);
    expect(after.find(node => node.id === 'mcp-permits').brief.sources).toEqual([
      { kind: 'website', title: 'Checklist', url: 'https://example.com/a', note: 'Why it matters.' },
      { kind: 'video', title: 'YouTube video', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
    ]);
    expect(after.find(node => node.id === 'mcp-costs').brief.step).toBe(planOf(after).plan.steps[2].id);
    expect(planOf(after).plan.steps[0].sources).toEqual([expect.objectContaining({ kind: 'file', title: 'menu.md', text: '# Menu' })]);
    expect(planOf(after)).toMatchObject({ canUndoOrganize: expect.any(Number), plan: { format: 2 } });
    expect(planOf(after).plan.log[0]).toMatchObject({ by: 'alex', person: true, text: expect.stringContaining('Organized the board') });

    await h.call(alex, 'planning:undoOrganizeBoard', { boardId: board, token: '', nodeKey: 'plan-main' });
    const undone = await read(board);
    expect(undone.filter(node => node.lane?.role === 'source')).toHaveLength(4);
    expect(undone.filter(node => node.stepCard)).toEqual([]);
    expect(undone.find(node => node.id === 'mcp-costs').brief.step).toBe('write-business-plan');
    expect(planOf(undone).plan.format).toBeUndefined();
    expect(words(undone)).toEqual(words(before));
    if (process.env.PLAN_BOARD_SNAPSHOT) writeFileSync(process.env.PLAN_BOARD_SNAPSHOT.replace(/\.json$/, '') + '.older-layout.json', JSON.stringify({ title: 'Older layout', nodes: undone }, null, 1));
  } finally { await claude.close(); boardId = previous; }
});

it('keeps notes from older clients short and inside the board', async () => {
  const board = await h.call(alex, 'library:create', { title: 'Older client' });
  const auth = { boardId: board, token: '' };
  const long = 'The city requires these on top of the county health permit.\n\n' + '1. Police Department Permits Unit: mobile food truck permit. '.repeat(30);
  expect(await h.call(alex, 'boards:updatePlan', {
    ...auth, planId: 'taco', goal: 'Launch a taco truck in Santa Clara.', expectedVersion: -1,
    steps: [{ title: 'Define concept & menu', status: 'pending', detail: 'Pick a niche. ' + 'Keep it to 6–8 items. '.repeat(20) }, { title: 'Get permits', status: 'working', detail: '' }],
  })).toEqual({ id: 'plan-taco', version: 0 });
  const site = await h.call(alex, 'boards:addAgentCard', {
    ...auth, cardId: 'city-site', kind: 'website', title: 'City permit page', content: 'Official checklist.',
    url: 'https://www.santaclaraca.gov/our-city/departments-a-f/community-development/planning-division/faqs', sourceIds: ['plan-taco'],
  });
  const note = await h.call(alex, 'boards:addAgentCard', { ...auth, cardId: 'city', kind: 'note', title: 'Finding: City of Santa Clara permits', content: long, url: '', sourceIds: ['plan-taco', site.id] });
  expect(note).toMatchObject({ id: 'mcp-city', created: true });
  const nodes = await read(board);
  // The plan, its two steps, an Unsorted step for the note without one, and the note itself.
  expect(nodes.map(node => node.stepCard ? 'step:' + node.title : node.id).sort()).toEqual(['mcp-city', 'plan-taco', 'step:Define concept & menu', 'step:Get permits', 'step:Unsorted']);
  expect(nodes.find(node => node.id === 'mcp-city')).toMatchObject({
    title: 'City of Santa Clara permits', body: 'The city requires these on top of the county health permit.',
    brief: { kind: 'finding', detail: long.trim(), step: null, sources: [expect.objectContaining({ kind: 'website', title: 'City permit page' })] },
  });
  expect(healthOf(nodes).ok).toBe(true);
  await expect(h.call(alex, 'boards:updatePlan', { ...auth, planId: 'taco', goal: 'Later', steps: [{ title: 'Only', status: 'done', detail: '' }], expectedVersion: 9 })).rejects.toThrow('changed');
  await expect(h.call(eric, 'boards:updatePlan', { ...auth, planId: 'taco', goal: 'Later', steps: [{ title: 'Only', status: 'done', detail: '' }], expectedVersion: 0 })).rejects.toThrow();
});

it('keeps cards short and sourced on a board without a plan', async () => {
  const board = await h.call(alex, 'library:create', { title: 'No plan yet' });
  const previous = boardId;
  boardId = board;
  const agent = await boardAgent(alex, 'Research helper');
  try {
    expect(await agent.call('get_brief')).toMatchObject({ plan: null, you: { agent: 'Research helper', mode: 'edit' }, guidance: expect.stringContaining('No plan yet') });
    const card = await agent.call('add_card', { requestId: 'pricing', kind: 'finding', title: 'Lunch pricing', summary: 'Nearby trucks charge $4–5 per taco.', detail: 'Checked three menus.' });
    expect(card).toMatchObject({ created: true, step: null });
    expect(await agent.call('add_source', { url: 'https://youtu.be/aqz-KE-bpKQ', note: 'Menu walkthrough.', forCard: card.id })).toMatchObject({ added: true, kind: 'video' });
    expect(await agent.call('add_source', { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', forCard: card.id })).toMatchObject({ added: false });
    await expect(agent.call('add_source', { url: 'javascript:alert(1)', forCard: card.id })).rejects.toThrow('public http(s)');
    await expect(agent.call('add_source', { url: 'https://example.com' })).rejects.toThrow('forCard');
    const nodes = await read(board);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ body: 'Nearby trucks charge $4–5 per taco.', brief: { sources: [expect.objectContaining({ kind: 'video' })] } });
    expect(nodes[0].lane).toBeUndefined();
    expect(await agent.call('read_card', { nodeKey: card.id })).toMatchObject({ detail: 'Checked three menus.' });
  } finally { await agent.close(); boardId = previous; }
});

it('sends each agent the cards for its work, says why, and after that only what changed', async () => {
  const board = await h.call(alex, 'library:create', { title: 'Todo app' });
  await h.call(alex, 'sharing:addMember', { boardId: board, username: 'eric', role: 'editor' });
  const previous = boardId;
  boardId = board;
  const claude = await localAgent(alex, 'claude-code');
  const codex = await boardAgent(eric, 'Codex · Eric');
  try {
    const plan = await claude.call('update_plan', {
      title: 'Simple todo app', goal: 'A small web app for todos on any device.', expectedVersion: -1,
      steps: [{ title: 'Decide the scope', status: 'working' }, { title: 'Build add, edit, delete', status: 'pending' }, { title: 'Sync across devices', status: 'pending' }, { title: 'Sign-in', status: 'pending' }],
    });
    const [scoping, build, sync, signin] = plan.steps.map((step: any) => step.id);
    await claude.call('add_card', { cardId: 'q-scope', kind: 'question', step: scoping, title: 'What is in version one?', summary: 'One list, or also due dates and sharing?' });
    await claude.call('add_card', { cardId: 'f-core', kind: 'finding', step: build, title: 'Four actions cover the core', summary: 'Add, check off, edit and delete.', files: ['src/components/TodoItem.tsx'] });
    await claude.call('add_card', { cardId: 'q-signin', kind: 'question', step: signin, title: 'Is sign-in needed?', summary: 'Without it, todos stay on one device.' });
    await expect(claude.call('add_card', { cardId: 'bad', kind: 'risk', step: sync, title: 'Bad link', summary: 'Points nowhere.', related: [{ cardId: 'nope' }] })).rejects.toThrow(/Related card "nope" is not on this board/);
    await expect(claude.call('add_card', { cardId: 'bad', kind: 'risk', step: sync, title: 'Bad file', summary: 'A link is not a file.', files: ['https://example.com'] })).rejects.toThrow(/paths inside the project/);
    const risk = await claude.call('add_card', {
      cardId: 'r-sync', kind: 'risk', step: sync, title: 'Edits on two devices can clash', summary: 'Offline edits can overwrite each other.',
      files: ['src/sync/merge.ts'], related: [{ cardId: 'q-signin', why: 'sync needs an account' }],
    });
    expect(risk).toMatchObject({ created: true, related: 1 });

    // Codex says it is editing the merge code: it gets the risk on that file and the question linked to it, not the scope question.
    const first = await codex.call('get_brief', { focus: { files: ['src/sync/merge.ts'] } });
    expect(first.forYou.basedOn).toBe('what you said you are working on');
    expect(first.forYou.cards.map((card: any) => [card.id, card.why])).toEqual([
      ['mcp-r-sync', 'edits merge.ts'], ['mcp-q-signin', 'linked: sync needs an account'],
    ]);
    expect(first.forYou.cards[0]).toMatchObject({ kind: 'risk', files: ['src/sync/merge.ts'], related: [{ id: 'mcp-q-signin', why: 'sync needs an account' }] });
    expect(first.sinceYourLastRead).toBeUndefined();
    expect(first.risks).toBeUndefined();

    // The plan card keeps what each agent was sent, so the board can show it.
    let lens = planOf(await read()).lens;
    const [codexId] = Object.entries(lens.reads).find(([, entry]: any) => entry.name === 'Codex · Eric')!;
    expect(lens.reads[codexId]).toMatchObject({ focus: { files: ['src/sync/merge.ts'] }, cards: ['mcp-r-sync', 'mcp-q-signin'] });
    expect(lens.reads[codexId].tokens).toBeLessThan(lens.reads[codexId].whole + 1000);

    // Reading again keeps the focus and does not resend what it already has.
    const second = await codex.call('get_brief');
    expect(second.forYou.basedOn).toBe('what you said last time');
    expect(second.forYou.cards.every((card: any) => card.unchanged)).toBe(true);
    expect(second.sinceYourLastRead.changes).toEqual([]);

    // A teammate's agent revises the risk: the next read sends it in full and says who changed it.
    await claude.call('revise_card', { cardId: 'r-sync', summary: 'Offline edits can overwrite each other; last edit wins per field.' });
    const third = await codex.call('get_brief');
    expect(third.forYou.cards.find((card: any) => card.id === 'mcp-r-sync')).toMatchObject({ summary: expect.stringContaining('last edit wins'), revision: 2 });
    expect(third.sinceYourLastRead.changes).toEqual([{ id: 'mcp-r-sync', title: 'Edits on two devices can clash', change: 'revised', by: 'Claude Code · alex' }]);

    // People correct the choice for that agent: mute one card, pin another.
    await h.call(alex, 'planning:setAgentCard', { ...scope(), nodeKey: 'plan-main', agentId: codexId, card: 'mcp-q-signin', pref: 'mute' });
    await h.call(alex, 'planning:setAgentCard', { ...scope(), nodeKey: 'plan-main', agentId: codexId, card: 'mcp-q-scope', pref: 'pin' });
    const fourth = await codex.call('get_brief', { full: true });
    expect(fourth.forYou.cards.map((card: any) => [card.id, card.why])).toEqual([['mcp-q-scope', 'pinned by alex'], ['mcp-r-sync', 'edits merge.ts']]);
    await expect(h.call(eric, 'planning:setAgentCard', { ...scope(), nodeKey: 'plan-main', agentId: 'nobody', card: 'mcp-q-scope', pref: 'pin' })).rejects.toThrow('has not read this board');

    // An agent that names no focus gets cards for the step it last wrote in.
    const fresh = await claude.call('get_brief');
    expect(fresh.forYou.basedOn).toBe('your latest card');
    expect(fresh.forYou.cards.map((card: any) => card.id)).toEqual(['mcp-r-sync', 'mcp-q-signin']);
    lens = planOf(await read()).lens;
    expect(Object.values(lens.reads).map((entry: any) => entry.name).sort()).toEqual(['Claude Code · alex', 'Codex · Eric']);
    if (process.env.PLAN_BOARD_SNAPSHOT) writeFileSync(process.env.PLAN_BOARD_SNAPSHOT.replace(/\.json$/, '') + '.todo.json', JSON.stringify({ title: 'Todo app', nodes: await read() }, null, 1));
  } finally { await claude.close(); await codex.close(); boardId = previous; }
});
