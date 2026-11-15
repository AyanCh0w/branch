// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { BoardAgentSettings } from '../accounts/board-agents';
import { ContextCanvas } from '../accounts/context-canvas';

const { query, mutate } = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn() }));
vi.mock('../backend/react', () => ({
  api: {
    agentContext: { read: 'agentContext:read' },
    boardAgents: Object.fromEntries(['settings', 'connect', 'disconnect', 'saveInstructions', 'activity', 'review']
      .map(name => [name, 'boardAgents:' + name])),
  },
  useQuery: (name, args) => args === 'skip' ? undefined : query(name, args),
  useMutation: name => args => mutate(name, args),
}));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => vi.resetAllMocks());

const Dialog = ({ children, title }: { children: React.ReactNode; title: string }) =>
  React.createElement('section', { 'aria-label': title }, children);

function change(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

it('issues a named connection from the board settings and shows its key only after creation', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  query.mockReturnValue({ instructions: { text: 'Use the API contract.', version: 1 }, connections: [] });
  mutate.mockResolvedValue({ id: 'connection', code: 'synthetic-agent-key' });

  try {
    await act(async () => root.render(React.createElement(BoardAgentSettings, { boardId: 'board', Dialog, onClose() {} })));
    const forms = container.querySelectorAll('form');
    expect(container.querySelector('textarea')?.value).toBe('Use the API contract.');
    expect(container.querySelector('[aria-label="Agent connection details"]')).toBeNull();
    await act(async () => change(forms[1].querySelector('input')!, 'Architecture agent'));
    await act(async () => forms[1].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mutate).toHaveBeenCalledWith('boardAgents:connect', {
      boardId: 'board', token: '', name: 'Architecture agent', mode: 'edit',
    });
    const fields = container.querySelectorAll<HTMLInputElement>('[aria-label="Agent connection details"] input');
    expect(fields[0].value).toContain('/api/backend?agent=1');
    expect(fields[1].value).toBe('synthetic-agent-key');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('opens a published proposal in Context and only offers approval to editors', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  const id = 'architecture-agent';
  const update = {
    id: 'change', author: 'Architecture agent', timestamp: 1,
    title: 'Proposed edit', result: 'Add pagination', nodeKey: 'api-contract',
    proposal: { title: 'API contract', body: 'Accept an optional cursor.', status: 'pending' },
  };
  query.mockReturnValue({ items: [update], hasMore: false });
  mutate.mockResolvedValue({ status: 'applied' });
  const previousHost = window.BranchHost;
  const previousIcons = window.Iconoir;
  window.BranchHost = { curve: () => '', formatCodingResult: () => '' };
  window.Iconoir = {};
  const render = canReview => root.render(React.createElement(ContextCanvas, {
    active: true, boardId: 'board', token: '', onSelect, selection: '',
    cards: [{ id, title: 'Architecture agent', boardAgent: true }], canReview,
  }));

  try {
    await act(async () => render(false));
    expect(query).toHaveBeenCalledWith('boardAgents:activity', { boardId: 'board', token: '', connectionId: id, limit: 10 });
    await act(async () => (container.querySelector('.context-update') as HTMLButtonElement).click());
    expect(container.querySelector('.context-reader')?.textContent).toContain('Architecture agent');
    const apply = () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Apply edit');
    expect(apply()).toBeUndefined();
    await act(async () => render(true));
    await act(async () => apply()!.click());
    expect(mutate).toHaveBeenCalledWith('boardAgents:review', { boardId: 'board', token: '', updateId: update.id, apply: true });
    expect(container.querySelector('.context-reader')?.textContent).toContain('Edit applied.');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.BranchHost = previousHost;
    window.Iconoir = previousIcons;
  }
});
