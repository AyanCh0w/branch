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
    chatgptBrowser: { count: 'chatgptBrowser:count', disconnectBoard: 'chatgptBrowser:disconnectBoard' },
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

function clipboard(writeText: (text: string) => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return () => {
    if (previous) Object.defineProperty(navigator, 'clipboard', previous);
    else Reflect.deleteProperty(navigator, 'clipboard');
  };
}

it.each([false, true])('copies a complete setup with no form, reusing the key after a clipboard failure (%s)', async (failsFirst) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  query.mockImplementation(name => name === 'boardAgents:settings'
    ? { instructions: { text: 'Use the API contract.', version: 1 }, connections: [] } : 1);
  mutate.mockResolvedValue({ id: 'connection', code: 'synthetic-agent-key' });
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  if (failsFirst) writeText.mockRejectedValueOnce(new Error('Clipboard denied'));
  const restoreClipboard = clipboard(writeText);

  try {
    await act(async () => root.render(React.createElement(BoardAgentSettings, { boardId: 'board', Dialog, onClose() {} })));
    const setupButton = container.querySelector<HTMLButtonElement>('button.a-primary')!;
    expect(setupButton.textContent).toBe('Copy setup instructions');
    expect(setupButton.disabled).toBe(false);
    expect(container.querySelector('details')?.open).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    await act(async () => setupButton.click());
    expect(mutate).toHaveBeenCalledWith('boardAgents:connect', {
      boardId: 'board', token: '', name: 'Board agent 1', mode: 'edit',
    });
    const value = writeText.mock.calls[0][0];
    expect(value).toContain('/app?board=board');
    expect(value).toContain('/api/backend?agent=1');
    expect(value).toContain('Connection key: synthetic-agent-key');
    expect(value).toContain('outside chats and shared files');
    expect(value.match(/^\d\./gm)).toHaveLength(3);
    if (failsFirst) {
      expect(container.querySelector<HTMLTextAreaElement>('textarea[readonly]')?.value).toBe(value);
      await act(async () => setupButton.click());
      expect(writeText.mock.calls[1][0]).toBe(value);
    }
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(setupButton.textContent).toContain('Copied to clipboard');
    expect(container.querySelector('textarea[readonly]')).toBeNull();
    expect(container.textContent).not.toContain('synthetic-agent-key');
    const disconnect = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Disconnect previous chats'))!;
    expect(disconnect.closest('details')?.open).toBe(false);
    await act(async () => disconnect.click());
    expect(mutate).toHaveBeenCalledWith('chatgptBrowser:disconnectBoard', { boardId: 'board' });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    restoreClipboard();
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
