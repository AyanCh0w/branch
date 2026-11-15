const BranchCapture = (() => {
  const currentTurn = 'main [data-talvt-turn-state]';
  const response = '[data-response-body]';
  const legacy = 'main [data-message-author-role="assistant"][data-message-id]';
  const completion = '[data-testid="copy-turn-action-button"],[data-testid="good-response-turn-action-button"]';
  const stopButton = '[data-testid="stop-button"],[data-testid="stop-generating-button"],button[aria-label="Stop generating"]';

  function baseline(document) {
    return new Set([...document.querySelectorAll(currentTurn + ' ' + response + ',' + legacy)]
      .map(message => message.dataset.responseBody || message.dataset.messageId));
  }

  function isGenerating(document) {
    if (document.querySelector(stopButton)) return true;
    const state = [...document.querySelectorAll(currentTurn)].at(-1)?.dataset.talvtTurnState;
    return !!state && !['complete', 'error', 'failed', 'cancelled', 'canceled', 'aborted', 'stopped'].includes(state);
  }

  function latestReply(document, seen) {
    const current = [...document.querySelectorAll(currentTurn)].at(-1);
    if (current) {
      if (current.dataset.talvtTurnState !== 'complete') return null;
      const body = [...current.querySelectorAll(response)].at(-1);
      const messageId = body?.dataset.responseBody;
      if (!messageId || seen.has(messageId)) return null;
      const section = body.querySelector('[data-dil-response]') || body;
      return { messageId, sections: [section] };
    }

    const message = [...document.querySelectorAll(legacy)].at(-1);
    if (!message || seen.has(message.dataset.messageId)) return null;
    const turn = message.closest('[data-testid^="conversation-turn-"],article');
    const streaming = '.result-streaming,[data-is-streaming="true"]';
    if (!turn?.querySelector(completion) || message.closest(streaming) || turn.querySelector(streaming)) return null;
    const sections = [...message.querySelectorAll('.markdown')].filter(section => !section.parentElement.closest('.markdown'));
    return { messageId: message.dataset.messageId, sections };
  }

  function completedReply(document, seen) {
    if (isGenerating(document)) return null;
    const reply = latestReply(document, seen);
    if (!reply) return null;
    let result = reply.sections.map(section => {
      const copy = section.cloneNode(true);
      // Keep only answer text, including code, without interactive controls.
      copy.querySelectorAll('button,[role="button"],[aria-hidden="true"],[hidden],script,style').forEach(element => element.remove());
      copy.querySelectorAll('pre').forEach(element => {
        const content = (element.querySelector('code') || element).textContent.trimEnd();
        let fence = '```';
        for (const [run] of content.matchAll(/`+/g)) {
          if (run.length >= fence.length) fence = '`'.repeat(run.length + 1);
        }
        element.replaceWith('\n\n' + fence + '\n' + content + '\n' + fence + '\n\n');
      });
      copy.querySelectorAll('p,blockquote,h1,h2,h3,h4,h5,h6').forEach(element => element.after('\n\n'));
      copy.querySelectorAll('li,tr,br').forEach(element => element.after('\n'));
      return copy.textContent.trim();
    }).join('\n\n').trim();
    if (!result) return null;
    if (result.length > 12_000) result = result.slice(0, 11_950) + '\n\n[Reply shortened by Branch]';
    return { messageId: reply.messageId, result };
  }

  return { baseline, completedReply, isGenerating };
})();
