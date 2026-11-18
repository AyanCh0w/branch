/* Structured plans: shared limits, plain-text fallbacks and the deterministic lane
   layout. The server uses this to place cards; the canvas uses it for group moves. */
(function (root) {
  const auto = typeof module === 'object' && module.exports ? require('./auto-layout.js') : root.BranchAutoLayout;

  // Hard limits keep the canvas scannable. Anything longer belongs in Context.
  const LIMITS = {
    planTitle: 60, goal: 280, steps: 200, stepTitle: 80, stepNote: 140, stepDetail: 4000,
    title: 60, summary: 200, points: 8, point: 140, detail: 8000,
    sources: 40, sourceTitle: 80, sourceNote: 140, fileText: 120000, log: 5,
    files: 20, path: 200, links: 12, linkWhy: 80, topic: 140,
  };
  const KINDS = ['decision', 'finding', 'question', 'risk', 'note'];
  const STATUSES = ['pending', 'working', 'done', 'blocked'];
  const KIND_LABEL = { decision: 'Decision', finding: 'Finding', question: 'Open question', risk: 'Risk', note: 'Note' };
  const STATUS_LABEL = { pending: 'To do', working: 'In progress', done: 'Done', blocked: 'Blocked' };
  const SIZE = { plan: 420, card: 340, source: 300, column: 104, row: 26, lane: 48, sourceRow: 16 };
  const MARK = { pending: '[ ]', working: '[~]', done: '[x]', blocked: '[!]' };

  // Plain text keeps context snapshots, search and older clients useful.
  function planText(plan) {
    return plan.goal + '\n\n' + plan.steps.map((step, index) =>
      `${index + 1}. ${MARK[step.status]} ${step.title}` + (step.note ? '\n   ' + step.note : '') +
      (step.detail ? '\n   ' + String(step.detail).replace(/\n/g, '\n   ') : '')).join('\n');
  }
  function cardText(brief) {
    return [brief.summary, ...(brief.points || []).map(point => '• ' + point)].filter(Boolean).join('\n');
  }
  function progress(plan) {
    const count = status => plan.steps.filter(step => step.status === status).length;
    return { total: plan.steps.length, done: count('done'), working: count('working'), blocked: count('blocked') };
  }

  // Conservative line estimates from the metrics in plan-board.css: a card may render
  // a line shorter than this, rarely taller, and the row gap absorbs the difference.
  const CHROME = 76; // card padding, title row and border around the body
  const lines = (text, perLine) => Math.max(1, Math.ceil(String(text || '').length / perLine));
  function planHeight(plan) {
    let height = 16 + 18 + lines(plan.goal, 46) * 23 + 12 + 22 + 12;
    for (const step of plan.steps) {
      height += 15 + lines(step.title, 42) * 21 + (step.note ? 2 + lines(step.note, 50) * 19 : 0);
    }
    return height + 45 + 12 + CHROME;
  }
  function cardHeight(brief) {
    let height = 16 + 24 + 8 + lines(brief.summary, 36) * 23;
    for (const point of brief.points || []) height += 7 + lines(point, 38) * 20;
    return height + 14 + 26 + 12 + CHROME;
  }
  function sourceHeight(node) {
    if (node.type === 'media' && node.mediaType === 'video') return Math.round((node.width || SIZE.source) * 9 / 16) + 92;
    const note = String(node.sourceNote || '');
    return 12 + 20 + (note ? 6 + Math.min(3, lines(note, 40)) * 19 : 0) + 10 + CHROME;
  }
  function memberHeight(node) {
    if (node.brief && node.body === node.brief.text) return cardHeight(node.brief);
    if (node.lane && node.lane.role === 'source') return sourceHeight(node);
    return auto.dimensions(node).height;
  }

  // A new plan starts in clear space beside existing work, with room to grow right and down.
  function origin(nodes) {
    if (!nodes.length) return { x: 80, y: 140 };
    const right = Math.max(...nodes.map(node => node.x + auto.dimensions(node).width));
    return { x: Math.round(right + 240), y: Math.round(Math.min(...nodes.map(node => node.y))) };
  }

  // Lanes: plan | one row per card, in step order | that card's sources. Rows never
  // overlap and keep the plan's step order, so connecting lines cannot cross.
  function layout(plan, members) {
    const positions = new Map();
    if (!plan || !plan.plan) return positions;
    const stepOrder = new Map(plan.plan.steps.map((step, index) => [step.id, index]));
    const free = members.filter(node => node.lane && !node.lane.pinned);
    const byId = new Map(free.map(node => [node.id, node]));
    const sequence = node => Number(node.lane.seq) || 0;
    const lane = node => {
      const step = node.brief ? node.brief.step : node.lane.step;
      return stepOrder.has(step) ? stepOrder.get(step) : stepOrder.size;
    };
    const anchored = new Set(members.filter(node => node.lane && node.lane.pinned && node.lane.role === 'card').map(node => node.id));
    const attached = node => node.lane.role === 'source' && (byId.has(node.lane.parent) || anchored.has(node.lane.parent));
    const rows = free.filter(node => !attached(node)).sort((a, b) => lane(a) - lane(b) || sequence(a) - sequence(b));
    const cardX = plan.x + (plan.width || SIZE.plan) + SIZE.column;
    const sourceX = cardX + SIZE.card + SIZE.column;
    let y = plan.y, previous = null;
    for (const row of rows) {
      if (previous !== null && lane(row) !== previous) y += SIZE.lane - SIZE.row;
      previous = lane(row);
      positions.set(row.id, { x: cardX, y });
      let sourceY = y;
      const sources = free.filter(node => attached(node) && node.lane.parent === row.id).sort((a, b) => sequence(a) - sequence(b));
      for (const source of sources) {
        positions.set(source.id, { x: sourceX, y: sourceY });
        sourceY += memberHeight(source) + SIZE.sourceRow;
      }
      y = Math.max(y + memberHeight(row), sourceY - SIZE.sourceRow) + SIZE.row;
    }
    // A card a person moved keeps its sources beside it, wherever it now sits.
    for (const card of members.filter(node => node.lane && node.lane.pinned && node.lane.role === 'card')) {
      let sourceY = card.y;
      const sources = free.filter(node => node.lane.role === 'source' && node.lane.parent === card.id).sort((a, b) => sequence(a) - sequence(b));
      for (const source of sources) {
        positions.set(source.id, { x: card.x + (card.width || SIZE.card) + SIZE.column, y: sourceY });
        sourceY += memberHeight(source) + SIZE.sourceRow;
      }
    }
    return positions;
  }

  // Everything that travels with a plan card when a person drags it.
  function groupMembers(node, nodes) {
    if (node.plan && node.visualPlan) {
      return nodes.filter(other => other.id === node.id || (other.lane && other.lane.plan === node.id && !other.lane.pinned));
    }
    if (node.lane && node.lane.role === 'card') {
      return nodes.filter(other => other.id === node.id || (other.lane && other.lane.role === 'source' && other.lane.parent === node.id && !other.lane.pinned));
    }
    return [node];
  }

  // ---- Format 2: one board that builds down and out ------------------------------
  // The plan is a single card. Steps fan out as columns under it and each step's cards
  // stack downward inside its column, so the browser lays everything out from real
  // sizes. What is visible is budgeted; the rest folds.
  // Nothing here limits how much a project can hold; these only bound stored history.
  const BUDGET = { perRow: 6, history: 8, log: 10 };
  const BOARD = { column: 286, gap: 14, pad: 20 };
  const liveSteps = plan => plan.steps.filter(step => !step.archived);
  function boardWidth(plan) {
    const columns = Math.max(2, Math.min(BUDGET.perRow, liveSteps(plan).length));
    return BOARD.pad * 2 + columns * BOARD.column + (columns - 1) * BOARD.gap;
  }
  const words = text => new Set(String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').map(word => word.replace(/s$/, '')).filter(word => word.length > 2));
  // Share of words two titles have in common: used to spot a second card on one topic.
  function similarity(a, b) {
    const left = words(a), right = words(b);
    if (!left.size || !right.size) return 0;
    let shared = 0;
    for (const word of left) if (right.has(word)) shared++;
    return shared / Math.min(left.size, right.size);
  }
  // How many distinct words two texts share: used to file a stray card under the step it is about.
  function sharedWords(a, b) {
    const left = words(a), right = words(b);
    let shared = 0;
    for (const word of left) if (right.has(word)) shared++;
    return shared;
  }
  const isCard = node => !!node.brief && !node.visualPlan && !!node.lane && node.lane.role === 'card';
  const isOpen = node => !(node.brief && node.brief.closed);
  // Questions, risks and decisions come before findings when a step is over its visible budget.
  const RANK = { question: 0, risk: 1, decision: 2, finding: 3, note: 4 };
  function stepCards(planId, stepId, nodes) {
    return nodes.filter(node => isCard(node) && node.lane.plan === planId && !node.lane.pinned && (node.brief.step || null) === stepId)
      .sort((a, b) => (RANK[a.brief.kind] ?? 9) - (RANK[b.brief.kind] ?? 9) || (b.brief.at || 0) - (a.brief.at || 0));
  }
  // The rules a board must keep. Organize restores them; tests assert them.
  function health(plan, nodes) {
    const data = plan.plan, known = new Set(data.steps.map(step => step.id));
    const members = nodes.filter(node => node.lane && node.lane.plan === plan.id);
    const cards = members.filter(isCard);
    const issues = [];
    const add = (rule, count, text) => { if (count) issues.push({ rule, count, text }); };
    add('home', cards.filter(node => node.brief.step && !known.has(node.brief.step)).length, 'cards point at a step that no longer exists');
    add('format', data.format === 2 ? 0 : 1, 'plan uses the older free-floating layout');
    add('sources', members.filter(node => node.lane.role === 'source').length, 'sources are separate cards instead of chips on their card');
    return { ok: !issues.length, issues };
  }

  // ---- What each agent is sent ------------------------------------------------------
  // An agent gets the plan every time, then only the cards near what it is working on:
  // the same step, the same files, cards linked to those, and cards on the same topic.
  // Every card it gets carries the reason, so people can see and correct the choice.
  const RELEVANCE = { step: 5, file: 5, folder: 3, link: 3, word: 1, words: 3, include: 3, budget: 3000 };
  const estimate = value => Math.ceil(JSON.stringify(value ?? '').length / 4);
  function common(a, b) {
    const right = words(b);
    return [...words(a)].filter(word => right.has(word));
  }
  const folder = path => String(path).split('/').slice(0, -1).join('/');
  const base = path => String(path).split('/').pop();
  // Both directions of every link: ones the card lists, ones that point at it, and
  // the cards it answered or was replaced by.
  function linksOf(node, nodes) {
    const out = [], add = (id, why) => { if (id && id !== node.id && !out.some(link => link.id === id)) out.push({ id, why }); };
    const brief = node.brief || {};
    for (const link of brief.links || []) add(link.card, link.why || '');
    for (const ref of brief.refs || []) add(ref, 'cited');
    if (brief.closed?.card) add(brief.closed.card, brief.closed.reason === 'answered' ? 'answered by this' : 'replaced by this');
    for (const other of nodes) {
      const theirs = other.brief;
      if (!theirs || other.id === node.id) continue;
      const link = (theirs.links || []).find(item => item.card === node.id);
      if (link) add(other.id, link.why || '');
      if ((theirs.refs || []).includes(node.id)) add(other.id, 'cites this');
      if (theirs.closed?.card === node.id) add(other.id, theirs.closed.reason === 'answered' ? 'this answers it' : 'this replaces it');
    }
    return out;
  }
  // cards: open cards on the plan. focus: { step, files, topic }. prefs: { pinned, muted }.
  function rank(cards, focus, prefs, all = cards) {
    const found = new Map(), byId = new Map(cards.map(card => [card.id, card]));
    const muted = new Set(prefs?.muted || []), pinned = new Set(prefs?.pinned || []);
    const add = (id, points, why) => {
      if (muted.has(id) || !byId.has(id)) return;
      const entry = found.get(id) || { id, score: 0, why: [] };
      entry.score += points;
      if (why && !entry.why.includes(why)) entry.why.push(why);
      found.set(id, entry);
    };
    const files = (focus?.files || []).map(String);
    for (const card of cards) {
      const brief = card.brief;
      if (focus?.step && brief.step === focus.step) add(card.id, RELEVANCE.step, 'same step');
      const touched = (brief.files || []).find(file => files.includes(file));
      const near = !touched && (brief.files || []).find(file => files.some(mine => folder(mine) && folder(mine) === folder(file)));
      if (touched) add(card.id, RELEVANCE.file, 'edits ' + base(touched));
      else if (near) add(card.id, RELEVANCE.folder, 'same folder as ' + base(files.find(mine => folder(mine) === folder(near))));
      if (focus?.topic) {
        const shared = common(focus.topic, card.title + ' ' + (brief.summary || ''));
        if (shared.length) add(card.id, Math.min(RELEVANCE.words, shared.length * RELEVANCE.word), 'about ' + shared.slice(0, 2).join(', '));
      }
    }
    // Cards linked to what the agent is working on come along, with the link's reason.
    const seeds = [...found.values()].filter(entry => entry.score >= RELEVANCE.include).map(entry => byId.get(entry.id));
    for (const seed of seeds) {
      for (const link of linksOf(seed, all)) add(link.id, RELEVANCE.link, link.why && link.why !== 'cited' ? 'linked: ' + link.why : `linked to “${clip(seed.title, 32)}”`);
    }
    for (const entry of found.values()) {
      const kind = byId.get(entry.id).brief.kind;
      if (entry.score >= RELEVANCE.include && (kind === 'risk' || kind === 'question')) entry.score += 1;
    }
    for (const id of pinned) if (byId.has(id) && !muted.has(id)) {
      const entry = found.get(id) || { id, score: 0, why: [] };
      found.set(id, { ...entry, score: entry.score + 1000, why: ['pinned by ' + (prefs.by || 'a teammate'), ...entry.why], pinned: true });
    }
    return [...found.values()].filter(entry => entry.score >= RELEVANCE.include)
      .sort((a, b) => b.score - a.score || (byId.get(b.id).brief.at || 0) - (byId.get(a.id).brief.at || 0))
      .map(entry => ({ id: entry.id, score: entry.score, why: entry.why.slice(0, 2).join(' · '), ...(entry.pinned ? { pinned: true } : {}) }));
  }
  const clip = (text, max) => { text = String(text || ''); return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text; };

  const api = {
    RELEVANCE, estimate, common, linksOf, rank,
    BUDGET, BOARD, liveSteps, boardWidth, similarity, sharedWords, isCard, isOpen, stepCards, health,
    LIMITS, KINDS, STATUSES, KIND_LABEL, STATUS_LABEL, SIZE,
    planText, cardText, progress, planHeight, cardHeight, sourceHeight, memberHeight, origin, layout, groupMembers,
  };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BranchPlanLayout = api;
})(typeof window === 'object' ? window : globalThis);
