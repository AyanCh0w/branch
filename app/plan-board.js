/* Canvas rendering for agent-written plans: a checklist plan card, short typed cards
   and compact source cards. Loaded before app.js, which calls in while rendering. */
(function () {
  const L = window.BranchPlanLayout;
  // View preferences on this device; never shared or saved.
  const openDetails = new Set(), openSteps = new Set(), openSources = new Set();
  let statusMenu = '';

  const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const glyph = name => window.Iconoir?.[name] || '';
  const markdown = text => typeof messageHTML === 'function' ? messageHTML(text, { linkPreviews: false }) : esc(text);
  const writable = () => !window.BoardShared?.enabled || window.BoardShared.writable;
  // app.js owns the board state; it may still be loading during the first render.
  const nodes = () => { try { return state.nodes; } catch { return []; } };
  const find = key => nodes().find(node => node.id === key);

  const isPlan = n => n.type === 'plan' && !!n.visualPlan && !!n.plan && n.body === n.planBody;
  const isBrief = n => n.type === 'plan' && !!n.brief && !n.visualPlan;
  const isSource = n => n.lane?.role === 'source' && ['web', 'upload', 'media'].includes(n.type);
  // Format 2: the plan is one board, and its cards live inside it.
  const isBoard = n => isPlan(n) && n.plan.format === 2;
  const isCompact = n => isSource(n) && n.type !== 'media' && !openSources.has(n.id);

  const KIND_ICON = { decision: 'check', finding: 'search', question: 'help-circle', risk: 'info-circle', note: 'page' };
  const STATUS_ICON = {
    pending: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
    working: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 2.75a7.25 7.25 0 0 1 0 14.5z" fill="currentColor"/></svg>',
    done: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="currentColor"/><path d="m6.4 10.3 2.4 2.4 4.8-5.2" fill="none" stroke="var(--theme-surface, #fff)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    blocked: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="currentColor"/><path d="M6.5 10h7" stroke="var(--theme-surface, #fff)" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  function ago(time) {
    const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + ' min ago';
    if (minutes < 24 * 60) return Math.round(minutes / 60) + ' h ago';
    return new Date(time).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function planMarkup(n) {
    const plan = n.plan, progress = L.progress(plan), canEdit = writable();
    const counts = new Map();
    for (const node of nodes()) {
      if (node.lane?.plan !== n.id || (node.lane.role === 'source' && node.lane.parent)) continue;
      const step = node.brief?.step || node.lane.step || '';
      counts.set(step, (counts.get(step) || 0) + 1);
    }
    const steps = plan.steps.map((step, index) => {
      const open = openSteps.has(n.id + ':' + step.id), label = L.STATUS_LABEL[step.status], cards = counts.get(step.id) || 0;
      const choosing = canEdit && statusMenu === n.id + ':' + step.id;
      return `<li class="plan-step" data-status="${step.status}" data-plan-step="${esc(step.id)}">`
        + `<button type="button" class="plan-step-status" data-step-status="${esc(step.id)}"${canEdit ? '' : ' disabled'} aria-label="Step ${index + 1}, ${label}. Change status" aria-expanded="${choosing}" data-tooltip="${label}${canEdit ? ' · click to change' : ''}">${STATUS_ICON[step.status]}</button>`
        + `<div class="plan-step-text"><span class="plan-step-title">${esc(step.title)}</span>`
        + (step.note ? `<span class="plan-step-note">${esc(step.note)}</span>` : '')
        + (choosing ? `<span class="plan-status-menu" role="group" aria-label="Set status for step ${index + 1}">${L.STATUSES.map(status =>
          `<button type="button" data-set-status="${status}" data-step="${esc(step.id)}" aria-pressed="${status === step.status}">${L.STATUS_LABEL[status]}</button>`).join('')}</span>` : '')
        + (step.detail ? `<button type="button" class="plan-link" data-step-detail="${esc(step.id)}" aria-expanded="${open}">${open ? 'Hide details' : 'Details'}</button>` : '')
        + (step.detail && open ? `<div class="plan-step-detail" data-message-text>${markdown(step.detail)}</div>` : '')
        + '</div>'
        + (cards ? `<span class="plan-step-count" aria-label="${cards} linked card${cards === 1 ? '' : 's'}">${cards}</span>` : '')
        + `<i class="plan-step-port${cards ? ' connected' : ''}" data-step-port="${esc(step.id)}" aria-hidden="true"></i></li>`;
    }).join('');
    const percent = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
    const summary = `${progress.done} of ${progress.total} done` + (progress.working ? ` · ${progress.working} in progress` : '') + (progress.blocked ? ` · ${progress.blocked} blocked` : '');
    const last = plan.log?.[0];
    const moved = nodes().some(node => node.lane?.plan === n.id && node.lane.pinned);
    return `<div class="card-main plan-outline">`
      + `<p class="plan-goal"><span class="plan-eyebrow">Goal</span>${esc(plan.goal)}</p>`
      + `<div class="plan-progress" role="img" aria-label="${esc(summary)}"><span class="plan-bar"><i style="width:${percent}%"></i></span><span>${esc(summary)}</span></div>`
      + `<ol class="plan-steps">${steps}</ol>`
      + `<div class="plan-foot"><span class="plan-updated">${last ? `<b>${esc(last.by)}</b> · ${esc(ago(last.at))}<br>${esc(last.text)}` : ''}</span>`
      + `<span class="plan-foot-actions">${moved && canEdit ? '<button type="button" class="plan-link" data-tidy-plan data-tooltip="Put every card back in its lane">Tidy</button>' : ''}`
      + (canEdit ? '<button type="button" class="plan-link pb-organize" data-organize data-tooltip="Tidy this plan into one board without changing any text">Organize</button>' : '')
      + `<button type="button" class="plan-link" data-open-context aria-controls="board-context">Context</button></span>`
      + `<i class="plan-step-port${counts.get('') ? ' connected' : ''}" data-step-port="" aria-hidden="true"></i></div></div>`;
  }

  function briefView(n) {
    const brief = n.brief;
    if (n.body !== brief.text) return `<div class="brief-edited" data-message-text>${markdown(n.body)}</div>`;
    return `<p class="brief-summary">${esc(brief.summary)}</p>`
      + (brief.points?.length ? `<ul class="brief-points">${brief.points.map(point => `<li>${esc(point)}</li>`).join('')}</ul>` : '');
  }

  function briefMarkup(n) {
    const brief = n.brief, open = openDetails.has(n.id), plan = find(n.lane?.plan);
    const stepIndex = plan?.plan ? L.liveSteps(plan.plan).findIndex(step => step.id === brief.step) : -1;
    const sources = brief.sources?.length || 0, chips = (brief.sources || []).some(item => item && typeof item === 'object');
    return `<div class="card-main note-content brief-body" data-brief-kind="${esc(brief.kind)}">`
      + `<div class="brief-meta"><span class="brief-chip">${glyph(KIND_ICON[brief.kind] || 'page')}${esc(L.KIND_LABEL[brief.kind] || 'Note')}</span>`
      + (stepIndex >= 0 ? `<span class="brief-step" title="${esc(plan.plan.steps[stepIndex].title)}">Step ${stepIndex + 1}</span>` : '') + '</div>'
      + `<div class="brief-view">${briefView(n)}</div>`
      + (chips ? `<div class="pb-chips">${sourceChips(n.id, brief.sources, 6)}</div>` : '')
      + (n.lane?.pinned && writable() ? '<button type="button" class="plan-link pb-putback" data-put-back>Put back in plan</button>' : '')
      + `<div class="plan-body" contenteditable="plaintext-only" role="textbox" aria-label="Note text" aria-multiline="true" data-edit="body" data-agent-note-editor hidden>${esc(n.body)}</div>`
      + `<div class="brief-foot"><span class="brief-by">${esc(brief.by || n.author || 'Agent')} · ${esc(ago(brief.at))}</span><span class="brief-actions">`
      + (sources ? `<span class="brief-sources" aria-label="${sources} source${sources === 1 ? '' : 's'}">${glyph('link')}${sources}</span>` : '')
      + (brief.detail ? `<button type="button" class="plan-link" data-brief-details aria-expanded="${open}">${open ? 'Hide details' : 'Details'}</button>` : '')
      + '</span></div>'
      + (brief.detail && open ? `<div class="brief-detail"><div data-message-text>${markdown(brief.detail)}</div><button type="button" class="plan-link" data-open-context aria-controls="board-context">Open in Context</button></div>` : '')
      + '</div>';
  }

  function sourceMarkup(n) {
    const file = n.type === 'upload';
    let host = '', href = '';
    if (!file) { try { const url = new URL(n.url); if (['http:', 'https:'].includes(url.protocol)) { host = url.hostname.replace(/^www\./, ''); href = url.href; } } catch { /* shown without a link */ } }
    const size = file ? (n.size >= 1048576 ? (n.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n.size || 0) / 1024)) + ' KB') : '';
    return `<div class="card-main source-compact-body">`
      + `<div class="source-line"><span class="source-icon">${glyph(file ? 'attachment' : 'link')}</span><span class="source-host">${esc(file ? 'File · ' + size : host || 'Website')}</span>`
      + `<span class="source-actions"><button type="button" class="plan-link" data-expand-source aria-expanded="false">${file ? 'View' : 'Preview'}</button>`
      + (href ? `<a class="plan-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Open ${glyph('arrow-up-right')}</a>` : '') + '</span></div>'
      + (n.sourceNote ? `<p class="source-note">${esc(n.sourceNote)}</p>` : '') + '</div>';
  }

  function markup(n) {
    if (isBoard(n)) return boardMarkup(n);
    if (isStepCard(n)) return stepMarkup(n);
    if (boardCard(n)) return itemCardMarkup(n);
    if (isPlan(n)) return planMarkup(n);
    if (isBrief(n)) return briefMarkup(n);
    if (isCompact(n)) return sourceMarkup(n);
    return '';
  }
  function cardClass(n) {
    if (isBoard(n)) return 'plan-board-card';
    if (isStepCard(n)) return 'pb-step-card pb-part' + (n.lane.pinned ? ' pb-moved' : '');
    if (boardCard(n)) return 'pb-item-card pb-part' + (n.lane.pinned ? ' pb-moved' : '');
    if (isPlan(n)) return 'plan-outline-card';
    if (isBrief(n)) return 'brief-card' + (openDetails.has(n.id) ? ' details-open' : '');
    if (isSource(n)) return 'lane-source ' + (isCompact(n) ? 'source-compact' : n.type === 'media' ? '' : 'source-expanded');
    return '';
  }
  function headerActions(n) {
    if (isSource(n) && n.type !== 'media' && openSources.has(n.id)) return '<button type="button" class="agent-note-edit" data-expand-source aria-expanded="true">Collapse</button>';
    if (boardCard(n) || isStepCard(n)) return '';
    if (isBrief(n) && writable()) return '<button type="button" class="agent-note-edit" data-edit-agent-note aria-label="Edit note">Edit</button>';
    return '';
  }
  const overviewType = n => isStepCard(n) ? 'Step' : isPlan(n) ? 'Plan' : isBrief(n) ? L.KIND_LABEL[n.brief.kind] || 'Note' : isSource(n) ? 'Source' : '';

  // Connecting lines: a plan links to each card from the matching step row, and a card
  // links to its own sources left to right. Ordered lanes mean these never cross.
  // Right-angle connector with soft corners, turning at a shared vertical channel.
  function elbow(a, b, channel) {
    if (Math.abs(b.y - a.y) < 1.5) return `M${a.x},${a.y} L${b.x},${b.y}`;
    const down = b.y > a.y ? 1 : -1;
    const r = Math.max(0, Math.min(10 * camera.z, Math.abs(b.y - a.y) / 2, Math.abs(channel - a.x), Math.abs(b.x - channel)));
    return `M${a.x},${a.y} H${channel - r} Q${channel},${a.y} ${channel},${a.y + down * r} V${b.y - down * r} Q${channel},${b.y} ${channel + r},${b.y} H${b.x}`;
  }
  function wire(target, context, source) {
    if (isBoard(source)) return null;
    if (isPlan(source) && target.lane?.plan === source.id) {
      const step = target.brief?.step || target.lane.step || '';
      const card = cardEl(source.id);
      const port = card?.querySelector(`[data-step-port="${CSS.escape(step)}"]`) || card?.querySelector('[data-step-port=""]');
      const start = elementPoint(port), end = portPoint(target, true, context.id);
      if (!start || !end) return null;
      // Every line from one plan turns at the same channel, so they read as one tree.
      const channel = card.getBoundingClientRect().right + 44 * camera.z;
      return end.x > channel ? { d: elbow(start, end, channel) } : { start };
    }
    if (context.cite && isSource(source)) {
      if (source.lane.parent !== target.id) return { skip: true };
      const from = cardEl(target.id)?.getBoundingClientRect(), to = cardEl(source.id)?.getBoundingClientRect();
      if (!from?.width || !to?.width) return { skip: true };
      const top = boardTop(), inset = 22 * camera.z;
      const y = to.top + Math.min(to.height / 2, 34 * camera.z);
      const start = { x: from.right, y: Math.min(Math.max(y, from.top + inset), from.bottom - inset) - top };
      const end = { x: to.left, y: y - top };
      if (end.x <= start.x) return { start, end, kind: 'wire-base wire-cite' };
      return { d: elbow(start, end, (start.x + end.x) / 2), kind: 'wire-base wire-cite' };
    }
    return null;
  }
  // A source filed under a step without a card still shows which step it belongs to.
  function laneWires() {
    const segments = arrange();
    for (const n of nodes()) {
      if (!isSource(n) || n.lane.parent || !n.lane.plan) continue;
      const plan = find(n.lane.plan), card = plan && isPlan(plan) ? cardEl(plan.id) : null;
      const to = card && cardEl(n.id)?.getBoundingClientRect();
      if (!to?.width) continue;
      const start = elementPoint(card.querySelector(`[data-step-port="${CSS.escape(n.lane.step || '')}"]`) || card.querySelector('[data-step-port=""]'));
      if (!start) continue;
      const end = { x: to.left, y: to.top + Math.min(to.height / 2, 34 * camera.z) - boardTop() };
      const channel = card.getBoundingClientRect().right + 44 * camera.z;
      segments.push({ d: end.x > channel ? elbow(start, end, channel) : curve(start, end), kind: 'wire-base wire-cite' });
    }
    return segments;
  }
  const ownsWire = (target, context) => {
    const source = find(context.source);
    return !!source && ((isPlan(source) && target.lane?.plan === source.id) || (!!context.cite && isSource(source)));
  };
  function moveMembers(n) {
    if (n && isBoard(n)) return null;
    if (!n || !(isPlan(n) || (n.lane?.role === 'card' && isBrief(n)))) return null;
    return L.groupMembers(n, nodes());
  }


  // ---- The board: plan on top, steps fanning out below, cards stacking down ----------
  const stepOpen = new Map(), moreOpen = new Set(), closedOpen = new Set(), itemOpen = new Set(), historyOpen = new Set();
  let editing = '', archivedOpen = false;
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const SOURCE_ICON = { website: 'link', video: 'youtube', file: 'attachment', github: 'github' };

  function sourceChips(owner, sources, limit, stepId) {
    const list = (sources || []).filter(item => item && typeof item === 'object');
    const shown = list.slice(0, limit);
    return shown.map((item, index) => {
      const safe = /^https?:\/\//.test(item.url || '');
      const label = `${glyph(SOURCE_ICON[item.kind] || 'link')}<span>${esc(item.title)}</span>`;
      const where = `data-source-owner="${esc(owner)}" data-source-index="${index}"${stepId !== undefined ? ` data-source-step="${esc(stepId)}"` : ''}`;
      return `<span class="pb-chip" title="${esc(item.note || item.url || item.title)}">`
        + (safe ? `<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<span class="pb-chip-text">${label}</span>`)
        + (writable() ? `<button type="button" data-pull-source ${where} aria-label="Put ${esc(item.title)} on the canvas as its own card" data-tooltip="Open as a card">${glyph('arrow-up-right')}</button>` : '')
        + '</span>';
    }).join('') + (list.length > shown.length ? `<span class="pb-chip pb-chip-more">+${list.length - shown.length}</span>` : '');
  }

  function itemMarkup(n, plan) {
    const brief = n.brief, open = itemOpen.has(n.id), canEdit = writable(), typed = n.body !== brief.text;
    const sources = (brief.sources || []).filter(item => item && typeof item === 'object');
    const head = `<button type="button" class="pb-item-head" data-toggle-item aria-expanded="${open}">`
      + `<span class="brief-chip">${glyph(KIND_ICON[brief.kind] || 'page')}${esc(L.KIND_LABEL[brief.kind] || 'Note')}</span>`
      + `<strong>${esc(n.title)}</strong></button>`;
    if (editing === n.id && canEdit) {
      return `<article class="pb-item editing" data-item="${esc(n.id)}" data-brief-kind="${esc(brief.kind)}">${head}`
        + `<form class="pb-edit" data-edit-item><label>Title<input name="title" maxlength="${L.LIMITS.title}" value="${esc(n.title)}" required></label>`
        + `<label>Summary<textarea name="summary" rows="3" maxlength="${L.LIMITS.summary}" required>${esc(typed ? n.body : brief.summary)}</textarea></label>`
        + `<label>Points, one per line<textarea name="points" rows="3">${esc((typed ? [] : brief.points || []).join('\n'))}</textarea></label>`
        + `<label>Step<select name="step"><option value="">Unsorted</option>${L.liveSteps(plan.plan).map((step, index) =>
          `<option value="${esc(step.id)}"${step.id === brief.step ? ' selected' : ''}>${index + 1}. ${esc(step.title)}</option>`).join('')}</select></label>`
        + '<p class="pb-error" role="alert" hidden></p><div class="pb-edit-actions"><button type="button" class="plan-link" data-cancel-edit>Cancel</button><button type="submit" class="pb-save">Save</button></div></form></article>';
    }
    const body = typed ? `<div class="pb-item-summary" data-message-text>${markdown(n.body)}</div>` : `<p class="pb-item-summary">${esc(brief.summary)}</p>`;
    const refs = (brief.refs || []).map(find).filter(Boolean);
    const edited = brief.editedBy ? `${esc(brief.editedBy)} · ${esc(ago(brief.editedAt))}` : `${esc(brief.by || 'Agent')} · ${esc(ago(brief.at))}`;
    const closed = brief.closed ? `<span class="pb-closed">${esc(brief.closed.reason === 'answered' ? 'Answered' : brief.closed.reason === 'superseded' ? 'Replaced' : 'Closed')}</span>` : '';
    let more = '';
    if (open) {
      const history = brief.history || [];
      more = (!typed && brief.points?.length ? `<ul class="brief-points">${brief.points.map(point => `<li>${esc(point)}</li>`).join('')}</ul>` : '')
        + (sources.length ? `<div class="pb-chips">${sourceChips(n.id, sources, 99)}</div>` : '')
        + (refs.length ? `<div class="pb-chips">${refs.map(ref => `<button type="button" class="pb-chip pb-ref" data-see-card="${esc(ref.id)}">${glyph('page')}<span>See: ${esc(ref.title)}</span></button>`).join('')}</div>` : '')
        + (brief.detail && openDetails.has(n.id) ? `<div class="pb-detail" data-message-text>${markdown(brief.detail)}</div>` : '')
        + (historyOpen.has(n.id) ? `<ol class="pb-history">${history.map(version => `<li><b>${esc(version.by)}</b> · ${esc(ago(version.at))}<span>${esc(version.title)} — ${esc(version.summary)}</span></li>`).join('')}</ol>` : '')
        + `<div class="pb-item-actions">`
        + (brief.detail ? `<button type="button" class="plan-link" data-brief-details aria-expanded="${openDetails.has(n.id)}">${openDetails.has(n.id) ? 'Hide reasoning' : 'Reasoning'}</button>` : '')
        + (history.length ? `<button type="button" class="plan-link" data-item-history aria-expanded="${historyOpen.has(n.id)}">${plural(history.length, 'earlier version')}</button>` : '')
        + (canEdit ? '<button type="button" class="plan-link" data-start-edit>Edit</button>' : '')
        + (canEdit ? `<button type="button" class="plan-link" data-close-item="${brief.closed ? 'open' : 'close'}">${brief.closed ? 'Reopen' : 'Close'}</button>` : '')
        + '<button type="button" class="plan-link" data-open-context aria-controls="board-context">Context</button></div>';
    }
    return `<article class="pb-item${open ? ' open' : ''}${brief.closed ? ' closed' : ''}" data-item="${esc(n.id)}" data-brief-kind="${esc(brief.kind)}">${head}${body}${more}`
      + `<div class="pb-item-foot"><span>${edited}${(brief.rev || 1) > 1 ? ` · v${brief.rev}` : ''}</span><span>${closed}${sources.length && !open ? `<span class="brief-sources">${glyph('link')}${sources.length}</span>` : ''}</span></div></article>`;
  }

  const countsLine = cards => {
    const of = kind => cards.filter(card => card.brief.kind === kind).length;
    const parts = [[of('decision'), 'decision'], [of('question'), 'question'], [of('risk'), 'risk'], [of('finding') + of('note'), 'finding']]
      .filter(([count]) => count).map(([count, word]) => plural(count, word));
    return parts.join(' · ');
  };

  // ---- Separate cards, laid out together --------------------------------------------
  // The plan, every step and every item is its own card on the open board. Where the
  // unmoved ones sit is worked out here, in the browser, from their real sizes: the plan
  // on top, steps in a row beneath it, each step's cards in a column under the step.
  // Nothing about these positions is saved, so opening a card simply moves its
  // neighbours along. A card a person drags keeps the place they gave it.
  // Steps sit in one row, however many there are: the board is as wide as the project.
  const SPACE = { column: 340, gapX: 84, gapY: 34, planToSteps: 104, stepToCards: 40, rows: 128, perRow: Infinity };
  const viewOf = new Map();            // plan id -> 'all' | 'outline'
  let focus = null;                    // { plan, step } while following one step
  const isStepCard = n => !!n?.stepCard && n.lane?.role === 'step' && isBoard(find(n.stepCard.plan) || {});
  const boardCard = n => !!n?.brief && !n.visualPlan && n.lane?.role === 'card' && isBoard(find(n.lane.plan) || {});
  const managed = n => (isStepCard(n) || boardCard(n)) && !n.lane.pinned;
  const stepOf = n => n.brief.step && find(n.lane.plan)?.plan.steps.some(step => step.id === n.brief.step && !step.archived) ? n.brief.step : '';
  const stepIsOpen = (plan, stepId) => {
    const key = plan.id + ':' + stepId;
    if (stepOpen.has(key)) return stepOpen.get(key);
    return plan.plan.steps.find(step => step.id === stepId)?.status !== 'done';
  };
  const cardsUnder = (plan, stepId) => nodes().filter(n => boardCard(n) && n.lane.plan === plan.id && !n.lane.pinned && stepOf(n) === stepId)
    .sort((a, b) => ({ question: 0, risk: 1, decision: 2, finding: 3, note: 4 }[a.brief.kind] ?? 9) - ({ question: 0, risk: 1, decision: 2, finding: 3, note: 4 }[b.brief.kind] ?? 9) || (b.brief.at || 0) - (a.brief.at || 0));
  // What a step shows right now: folded steps and the outline view show none; an open
  // step shows its first few open cards unless someone asked for all of them.
  function shownUnder(plan, stepId) {
    const key = plan.id + ':' + stepId, all = cardsUnder(plan, stepId);
    if ((viewOf.get(plan.id) || 'all') === 'outline' && !(focus?.plan === plan.id && focus.step === stepId)) return [];
    const open = all.filter(L.isOpen), closed = all.filter(card => !L.isOpen(card));
    // A finished step folds away, but anything still unresolved under it stays in sight
    // until someone folds the step on purpose.
    if (!stepIsOpen(plan, stepId)) return stepOpen.has(key) ? [] : open.filter(card => ['question', 'risk'].includes(card.brief.kind));
    return [...open, ...(closedOpen.has(key) ? closed : [])];
  }
  // Cards that are folded away are simply not on the board for now.
  function embedded(n) {
    if (isStepCard(n)) return n.stepCard.step === '' && !cardsUnder(find(n.stepCard.plan), '').length;
    if (!boardCard(n) || n.lane.pinned) return false;
    const plan = find(n.lane.plan);
    return !shownUnder(plan, stepOf(n)).includes(n);
  }

  function boardMarkup(n) {
    const plan = n.plan, canEdit = writable(), all = nodes();
    const live = L.liveSteps(plan), progress = L.progress({ steps: live }), check = L.health(n, all);
    const percent = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
    const summary = `${progress.done} of ${progress.total} done` + (progress.working ? ` · ${progress.working} in progress` : '') + (progress.blocked ? ` · ${progress.blocked} blocked` : '');
    const last = plan.log?.[0], history = historyOpen.has(n.id), view = viewOf.get(n.id) || 'all';
    const moved = all.filter(card => card.lane?.plan === n.id && card.lane.pinned).length;
    return `<div class="card-main plan-board">`
      + `<p class="plan-goal"><span class="plan-eyebrow">Goal</span>${esc(plan.goal)}</p>`
      + `<div class="plan-progress" role="img" aria-label="${esc(summary)}"><span class="plan-bar"><i style="width:${percent}%"></i></span><span>${esc(summary)}</span></div>`
      + `<div class="pb-view" role="group" aria-label="How much of the plan to show"><button type="button" data-plan-view="outline" aria-pressed="${view === 'outline'}">Outline</button><button type="button" data-plan-view="all" aria-pressed="${view === 'all'}">Everything</button>`
      + (focus?.plan === n.id ? '<button type="button" class="plan-link" data-clear-focus>Stop following</button>' : '') + '</div>'
      + (check.ok ? '' : `<p class="pb-health" title="${esc(check.issues.map(issue => `${issue.count} ${issue.text}`).join('\n'))}">Needs organizing</p>`)
      + `<div class="pb-meta"><span class="plan-updated">${last ? `<b>${esc(last.by)}</b> · ${esc(ago(last.at))}<br>${esc(last.text)}` : ''}</span></div>`
      + `<div class="pb-actions">`
      + (canEdit ? `<button type="button" class="pb-save" data-organize data-tooltip="Put every card back in its place without changing any text">Organize${moved ? ` (${moved} moved)` : ''}</button>` : '')
      + (canEdit && n.canUndoOrganize ? '<button type="button" class="plan-link" data-undo-organize>Undo organize</button>' : '')
      + (plan.log?.length ? `<button type="button" class="plan-link" data-plan-history aria-expanded="${history}">History</button>` : '')
      + '<button type="button" class="plan-link" data-open-context aria-controls="board-context">Context</button></div>'
      + (history ? `<ol class="pb-history">${plan.log.map(entry => `<li><b>${esc(entry.by)}</b> · ${esc(ago(entry.at))}<span>${esc(entry.text)}</span></li>`).join('')}</ol>` : '')
      + (plan.sources?.length ? `<div class="pb-chips">${sourceChips(n.id, plan.sources, 6, '')}</div>` : '') + '</div>';
  }

  function stepMarkup(n) {
    const plan = find(n.stepCard.plan), id = n.stepCard.step, canEdit = writable(), key = plan.id + ':' + id;
    const live = L.liveSteps(plan.plan), index = live.findIndex(step => step.id === id), step = live[index];
    const all = cardsUnder(plan, id), open = all.filter(L.isOpen), closed = all.length - open.length;
    const shown = shownUnder(plan, id), unfolded = stepIsOpen(plan, id), following = focus?.plan === plan.id && focus.step === id;
    const status = step ? step.status : 'pending', label = L.STATUS_LABEL[status], choosing = canEdit && step && statusMenu === key;
    return `<div class="card-main pb-step-main" data-status="${status}" data-plan-step="${esc(id)}">`
      + `<div class="pb-step-head">`
      + (step ? `<button type="button" class="plan-step-status" data-step-status="${esc(id)}"${canEdit ? '' : ' disabled'} aria-label="Step ${index + 1}, ${label}. Change status" aria-expanded="${choosing}" data-tooltip="${label}${canEdit ? ' · click to change' : ''}">${STATUS_ICON[status]}</button>` : '')
      + `<div class="pb-step-title"><span class="pb-step-number">${step ? `Step ${index + 1} · ${esc(label)}` : 'No step yet'}</span>${n.body ? `<span class="plan-step-note">${esc(n.body)}</span>` : ''}</div></div>`
      + (choosing ? `<span class="plan-status-menu" role="group" aria-label="Set status for step ${index + 1}">${L.STATUSES.map(option =>
        `<button type="button" data-set-status="${option}" data-step="${esc(id)}" aria-pressed="${option === status}">${L.STATUS_LABEL[option]}</button>`).join('')}</span>` : '')
      + `<p class="pb-counts">${open.length ? esc(countsLine(open)) : 'Nothing recorded yet'}</p>`
      + (step?.sources?.length ? `<div class="pb-chips">${sourceChips(plan.id, step.sources, 99, id)}</div>` : '')
      + `<div class="pb-step-actions">`
      + (all.length ? `<button type="button" class="plan-link" data-fold-step="${esc(key)}" aria-expanded="${unfolded}">${unfolded ? 'Fold' : `Show ${plural(open.length, 'card')}`}</button>` : '')
      + (unfolded && closed ? `<button type="button" class="plan-link" data-closed="${esc(key)}" aria-expanded="${closedOpen.has(key)}">${closedOpen.has(key) ? 'Hide' : 'Show'} ${closed} closed</button>` : '')
      + (all.length ? `<button type="button" class="plan-link" data-follow-step="${esc(id)}" aria-pressed="${following}">${following ? 'Following' : 'Follow'}</button>` : '')
      + (n.lane.pinned && canEdit ? '<button type="button" class="plan-link" data-put-back>Put back</button>' : '')
      + '</div></div>';
  }
  const itemCardMarkup = n => `<div class="card-main pb-card">${itemMarkup(n, find(n.lane.plan))}`
    + (n.lane.pinned && writable() ? '<button type="button" class="plan-link pb-putback" data-put-back>Put back in its column</button>' : '') + '</div>';

  // Lay the unmoved cards out and return the short connectors between them.
  const screen = (x, y) => ({ x: x * camera.z + camera.x, y: y * camera.z + camera.y });
  const path = points => 'M' + points.map(point => { const at = screen(point[0], point[1]); return `${at.x},${at.y}`; }).join(' L');
  function arrange() {
    const segments = [], all = nodes(), busy = id => !!window.BranchHost?.isManipulating?.(id);
    const size = n => { const el = cardEl(n.id); return el && !el.hidden ? { w: el.offsetWidth || n.width || SPACE.column, h: el.offsetHeight } : null; };
    const put = (n, x, y) => {
      if (busy(n.id) || (Math.abs(n.x - x) < 0.5 && Math.abs(n.y - y) < 0.5)) return;
      n.x = x; n.y = y;
      const el = cardEl(n.id);
      if (el) el.style.transform = `translate3d(${x}px,${y}px,0)`;
    };
    for (const plan of all.filter(isBoard)) {
      const planSize = size(plan);
      if (!planSize) continue;
      const steps = all.filter(n => isStepCard(n) && n.stepCard.plan === plan.id && !embedded(n));
      const order = id => { const index = L.liveSteps(plan.plan).findIndex(step => step.id === id); return index < 0 ? 999 : index; };
      steps.sort((a, b) => order(a.stepCard.step) - order(b.stepCard.step));
      const flowing = steps.filter(step => !step.lane.pinned);
      const dimmed = n => !!focus && focus.plan === plan.id && focus.step !== (n.stepCard ? n.stepCard.step : stepOf(n));
      const centre = plan.x + planSize.w / 2, busY = plan.y + planSize.h + SPACE.planToSteps / 2;
      let rowTop = plan.y + planSize.h + SPACE.planToSteps, outer = null;
      for (let start = 0; start < flowing.length; start += SPACE.perRow) {
        const row = flowing.slice(start, start + SPACE.perRow);
        const width = row.length * SPACE.column + (row.length - 1) * SPACE.gapX, left = centre - width / 2;
        let bottom = rowTop;
        row.forEach((step, index) => {
          put(step, left + index * (SPACE.column + SPACE.gapX), rowTop);
        });
        // The first row hangs from the plan; later rows hang from a rail down the left side.
        // The rail runs outside the widest row, so it never passes behind a card.
        if (outer === null) outer = left - SPACE.gapX / 2;
        const railX = Math.min(outer, left - SPACE.gapX / 2), channel = start === 0 ? busY : rowTop - SPACE.rows / 2;
        if (start > 0) segments.push({ d: path([[centre, busY], [railX, busY], [railX, channel], [left + SPACE.column / 2, channel]]), kind: 'wire-base wire-cite' });
        else segments.push({ d: path([[centre, plan.y + planSize.h], [centre, busY]]), kind: 'wire-base wire-cite' });
        segments.push({ d: path([[left + SPACE.column / 2, channel], [left + width - SPACE.column / 2, channel]]), kind: 'wire-base wire-cite' });
        for (const step of row) {
          const box = size(step);
          segments.push({ d: path([[step.x + SPACE.column / 2, channel], [step.x + SPACE.column / 2, step.y]]), kind: 'wire-base wire-cite' });
          bottom = Math.max(bottom, step.y + (box?.h || 0));
        }
        for (const step of row) bottom = Math.max(bottom, column(plan, step, segments, size, put));
        rowTop = bottom + SPACE.rows;
      }
      // A step someone moved keeps its place and brings its cards with it.
      for (const step of steps.filter(item => item.lane.pinned)) column(plan, step, segments, size, put);
      for (const n of all) {
        if (!(isStepCard(n) ? n.stepCard.plan === plan.id : boardCard(n) && n.lane.plan === plan.id)) continue;
        cardEl(n.id)?.classList.toggle('pb-dim', dimmed(n));
      }
    }
    document.getElementById('cards')?.classList.toggle('pb-animate', !gesture);
    return segments;
  }
  function column(plan, step, segments, size, put) {
    const box = size(step);
    let y = step.y + (box?.h || 0), previous = y;
    const x = step.x, rail = x + 30;
    for (const card of shownUnder(plan, step.stepCard.step)) {
      const top = y + (previous === step.y + (box?.h || 0) ? SPACE.stepToCards : SPACE.gapY);
      put(card, x, top);
      const cardBox = size(card);
      if (!cardBox) continue;
      segments.push({ d: path([[rail, y], [rail, card.y]]), kind: 'wire-base wire-cite' });
      y = card.y + cardBox.h; previous = y;
    }
    return y;
  }
  // Move the view so one step and its cards fill the screen.
  function showStep(plan, stepId) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const group = nodes().filter(n => (isStepCard(n) && n.stepCard.plan === plan.id && n.stepCard.step === stepId) || (boardCard(n) && n.lane.plan === plan.id && stepOf(n) === stepId && !embedded(n)));
      const boxes = group.map(n => ({ n, el: cardEl(n.id) })).filter(item => item.el && !item.el.hidden);
      if (!boxes.length) return;
      const left = Math.min(...boxes.map(b => b.n.x)), top = Math.min(...boxes.map(b => b.n.y));
      const right = Math.max(...boxes.map(b => b.n.x + b.el.offsetWidth)), bottom = Math.max(...boxes.map(b => b.n.y + b.el.offsetHeight));
      camera.z = Math.max(0.35, Math.min(1, (innerWidth - 160) / (right - left), (innerHeight - 260) / (bottom - top)));
      camera.x = (innerWidth - (right - left) * camera.z) / 2 - left * camera.z;
      camera.y = 110 - top * camera.z;
      applyCamera(); requestDraw();
    }));
  }

  // Organize shows what it will do before it does anything.
  function organizeDialog(n, preview, apply) {
    const dialog = document.createElement('dialog');
    dialog.className = 'pb-dialog';
    dialog.setAttribute('aria-label', 'Organize this plan');
    dialog.innerHTML = '<h2>Organize this plan</h2>'
      + (preview.actions.length
        ? `<p>This rearranges the board. It does not change, shorten or delete anyone’s text, and you can undo it.</p><ul>${preview.actions.map(action => `<li><b>${action.count}</b> ${esc(action.text)}</li>`).join('')}</ul>`
        : '<p>Everything is already in place.</p>')
      + `<div class="pb-edit-actions"><button type="button" class="plan-link" data-dialog-cancel>${preview.actions.length ? 'Cancel' : 'Close'}</button>${preview.actions.length ? '<button type="button" class="pb-save" data-dialog-apply>Organize</button>' : ''}</div>`;
    dialog.addEventListener('click', async event => {
      if (event.target.closest('[data-dialog-cancel]')) dialog.close();
      if (event.target.closest('[data-dialog-apply]')) { dialog.close(); await apply(); }
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }
  const remote = (operation, payload) => window.BoardShared.plan(operation, payload);
  const board = n => isBoard(n) ? n : find(n.lane?.plan);
  // Redraw a card together with the step and plan cards that summarise it.
  function redraw(n) {
    const plan = board(n);
    refreshCard(n);
    if (plan) for (const other of nodes()) if (other !== n && (other === plan || (isStepCard(other) && other.stepCard.plan === plan.id))) refreshCard(other);
    requestDraw();
  }

  document.addEventListener('submit', async event => {
    const form = event.target.closest?.('[data-edit-item]');
    if (!form) return;
    event.preventDefault();
    const n = find(form.closest('[data-item]').dataset.item);
    if (!n) return;
    const data = new FormData(form), points = String(data.get('points') || '').split('\n').map(line => line.trim()).filter(Boolean);
    const change = { title: String(data.get('title')).trim(), summary: String(data.get('summary')).trim(), points, step: data.get('step') || null };
    const problem = form.querySelector('.pb-error');
    try {
      if (window.BoardShared?.enabled) await remote('editCard', { nodeKey: n.id, ...change });
      else { n.title = change.title; n.brief = { ...n.brief, summary: change.summary, points, step: change.step }; n.brief.text = n.body = L.cardText(n.brief); }
      editing = ''; redraw(n);
    } catch (error) { problem.textContent = String(error.message || 'Could not save.').replace(/^Fix and retry: /, ''); problem.hidden = false; }
  });

  document.addEventListener('click', async event => {
    const cardEl = event.target.closest?.('.card[data-node]');
    const owner = cardEl && find(cardEl.dataset.node);
    if (!owner) return;
    const itemEl = event.target.closest('[data-item]');
    const n = itemEl ? find(itemEl.dataset.item) : owner;
    if (!n) return;
    const flip = (set, key) => { set.has(key) ? set.delete(key) : set.add(key); redraw(n); };
    const attempt = async work => { try { await work(); } catch (error) { notify(String(error.message || 'Could not update the board.').replace(/^Fix and retry: /, '')); } };
    const hit = selector => event.target.closest(selector);
    if (hit('[data-fold-step]')) {
      const key = hit('[data-fold-step]').dataset.foldStep;
      stepOpen.set(key, hit('[data-fold-step]').getAttribute('aria-expanded') !== 'true');
      return redraw(owner);
    }
    if (hit('[data-plan-view]')) { viewOf.set(owner.id, hit('[data-plan-view]').dataset.planView); focus = null; redraw(owner); return requestAnimationFrame(() => requestAnimationFrame(fit)); }
    if (hit('[data-clear-focus]')) { focus = null; return redraw(owner); }
    if (hit('[data-follow-step]')) {
      const plan = board(owner), step = hit('[data-follow-step]').dataset.followStep;
      const same = focus?.plan === plan.id && focus.step === step;
      focus = same ? null : { plan: plan.id, step };
      if (!same) { stepOpen.set(plan.id + ':' + step, true); moreOpen.add(plan.id + ':' + step); showStep(plan, step); }
      return redraw(owner);
    }
    if (hit('[data-more]')) return flip(moreOpen, hit('[data-more]').dataset.more);
    if (hit('[data-closed]')) return flip(closedOpen, hit('[data-closed]').dataset.closed);
    if (hit('[data-archived]')) { archivedOpen = !archivedOpen; return redraw(owner); }
    if (hit('[data-plan-history]')) return flip(historyOpen, owner.id);
    if (itemEl && hit('[data-toggle-item]')) return flip(itemOpen, n.id);
    if (itemEl && hit('[data-item-history]')) return flip(historyOpen, n.id);
    if (itemEl && hit('[data-brief-details]')) { event.stopImmediatePropagation(); return flip(openDetails, n.id); }
    if (itemEl && hit('[data-start-edit]')) { editing = n.id; return redraw(n); }
    if (hit('[data-cancel-edit]')) { editing = ''; return redraw(n); }
    if (hit('[data-see-card]')) {
      const target = find(hit('[data-see-card]').dataset.seeCard);
      if (!target) return;
      if (boardCard(target) && !target.lane.pinned) {
        const key = target.lane.plan + ':' + stepOf(target);
        stepOpen.set(key, true); moreOpen.add(key); if (!L.isOpen(target)) closedOpen.add(key); itemOpen.add(target.id); redraw(target);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('branch:show-coding-note', { detail: target.id }))));
      return;
    }
    if (hit('[data-pull-source]')) {
      const button = hit('[data-pull-source]');
      const holder = find(button.dataset.sourceOwner);
      const list = !holder ? [] : holder.brief ? holder.brief.sources : button.dataset.sourceStep ? holder.plan.steps.find(step => step.id === button.dataset.sourceStep)?.sources : holder.plan.sources;
      const source = (list || []).filter(item => item && typeof item === 'object')[Number(button.dataset.sourceIndex)];
      const plan = board(owner) || owner;
      if (!source || !writable()) return;
      if (source.url) openURL(source.url, plan);
      else {
        remember();
        const spot = freePosition(plan.x + (plan.width || 420) + 60, plan.y, 380);
        const file = { id: id(), type: 'upload', title: source.title, text: source.text || '', mime: 'text/plain', size: (source.text || '').length, asset: id(), revision: 1, ...spot };
        state.nodes.push(file); refreshCard(file); save();
      }
      return;
    }
    if (hit('[data-organize]') && window.BoardShared?.enabled) {
      return attempt(async () => {
        const plan = board(owner) || owner;
        const preview = await remote('organizeBoard', { nodeKey: plan.id, apply: false });
        organizeDialog(plan, preview, () => attempt(async () => { await remote('organizeBoard', { nodeKey: plan.id, apply: true }); notify('Organized. Use Undo organize on the plan to go back.'); }));
      });
    }
    if (hit('[data-undo-organize]') && window.BoardShared?.enabled) return attempt(() => remote('undoOrganizeBoard', { nodeKey: owner.id }));
    if (hit('[data-put-back]') && window.BoardShared?.enabled) return attempt(() => remote('pullOut', { nodeKey: owner.id, out: false }));
    if (itemEl && hit('[data-pull-out]') && window.BoardShared?.enabled) return attempt(() => remote('pullOut', { nodeKey: n.id, out: true }));
    if (itemEl && hit('[data-close-item]') && window.BoardShared?.enabled) {
      return attempt(() => remote('setCardClosed', { nodeKey: n.id, closed: hit('[data-close-item]').dataset.closeItem === 'close' }));
    }
    if (itemEl && hit('[data-open-context]')) {
      event.stopImmediatePropagation();
      window.dispatchEvent(new CustomEvent('branch:show-context', { detail: { id: n.brief?.agentId || '', nodeKey: n.id } }));
    }
  }, true);

  document.addEventListener('click', async event => {
    const card = event.target.closest?.('.card[data-node]');
    const n = card && find(card.dataset.node);
    if (!n) return;
    const toggle = (set, key) => { set.has(key) ? set.delete(key) : set.add(key); refreshCard(n); };
    const stepDetail = event.target.closest('[data-step-detail]');
    if (stepDetail) return toggle(openSteps, n.id + ':' + stepDetail.dataset.stepDetail);
    if (event.target.closest('[data-brief-details]')) return toggle(openDetails, n.id);
    if (event.target.closest('[data-expand-source]')) return toggle(openSources, n.id);
    if (event.target.closest('[data-open-context]')) {
      const agent = n.brief?.agentId || n.plan?.log?.find(entry => entry.agentId)?.agentId;
      window.dispatchEvent(new CustomEvent('branch:show-context', { detail: { id: agent || '', nodeKey: n.id } }));
      return;
    }
    const owner = n.stepCard ? find(n.stepCard.plan) : n;
    const both = () => { refreshCard(n); if (owner && owner !== n) refreshCard(owner); };
    const status = event.target.closest('[data-step-status]');
    if (status && owner && isPlan(owner) && writable()) {
      const key = owner.id + ':' + status.dataset.stepStatus;
      statusMenu = statusMenu === key ? '' : key;
      both();
      return;
    }
    const choice = event.target.closest('[data-set-status]');
    if (choice && owner && isPlan(owner) && writable()) {
      const step = owner.plan.steps.find(item => item.id === choice.dataset.step);
      statusMenu = '';
      if (!step || step.status === choice.dataset.setStatus) return both();
      const previous = step.status;
      step.status = choice.dataset.setStatus;
      both();
      if (!window.BoardShared?.enabled) return;
      try { await window.BoardShared.plan('setStep', { nodeKey: owner.id, stepId: step.id, status: step.status }); }
      catch (error) { step.status = previous; both(); notify(error.message || 'Could not update the plan.'); }
      return;
    }
    if (event.target.closest('[data-tidy-plan]') && window.BoardShared?.enabled) {
      try { await window.BoardShared.plan('tidy', { nodeKey: n.id }); }
      catch (error) { notify(error.message || 'Could not tidy the plan.'); }
    }
  });

  // Keep everything in place the moment new board data arrives, before the next paint.
  window.addEventListener('branch:board-updated', () => { try { arrange(); } catch { /* the canvas is still starting */ } });
  window.BranchPlanBoard = { markup, cardClass, headerActions, overviewType, briefView, wire, laneWires, ownsWire, moveMembers, isPlan, isBrief, isSource, isBoard, embedded, managed };
})();
