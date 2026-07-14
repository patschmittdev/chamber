/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary, MindContext } from '@chamber/shared/types';
import { installElectronAPI, installMenuDom, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { ConversationHistoryPanel } from './ConversationHistoryPanel';

installMenuDom();

const STORAGE_KEY = 'chamber:conversation-history-collapsed';

function openRowMenu(title: string): void {
  const trigger = screen.getByRole('button', { name: `More actions for ${title}` });
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\agents\\monica',
  identity: { name: 'Monica', systemMessage: '# Monica' },
  status: 'ready',
};

describe('ConversationHistoryPanel', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    localStorage.clear();
    api = installElectronAPI();
    (api.conversationHistory.list as ReturnType<typeof vi.fn>).mockReturnValue(new Promise<ConversationSummary[]>(() => undefined));
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts expanded and persists collapse toggles', async () => {
    renderHistoryPanel({ activeMindId: mind.mindId, minds: [mind], conversationHistoryByMind: { [mind.mindId]: [] } });

    const history = screen.getByLabelText('Conversation history');
    expect(history.className).toContain('w-80');
    expect(screen.getByRole('button', { name: 'Collapse history panel' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse history panel' }));

    expect(history.className).toContain('w-10');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(screen.getByRole('button', { name: 'Expand history panel' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Expand history panel' }));

    expect(history.className).toContain('w-80');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('restores the saved collapsed preference while preserving the history landmark', () => {
    localStorage.setItem(STORAGE_KEY, 'true');

    renderHistoryPanel({ activeMindId: mind.mindId, minds: [mind], conversationHistoryByMind: { [mind.mindId]: [] } });

    const history = screen.getByLabelText('Conversation history');
    expect(history.className).toContain('w-10');
    expect(within(history).getByRole('button', { name: 'Expand history panel' })).toBeTruthy();
  });

  it('gives the conversation search input the shared focus-ring utility', () => {
    renderHistoryPanel({ activeMindId: mind.mindId, minds: [mind], conversationHistoryByMind: { [mind.mindId]: [] } });

    const search = screen.getByLabelText('Search conversations');
    expect(search.className).toContain('focus-ring');
    expect(search.className).not.toContain('focus:border-primary');
  });

  it('locks the history rail collapsed and disables the toggle when the shell forces auto-collapse', () => {
    render(
      <AppStateProvider testInitialState={{ activeMindId: mind.mindId, minds: [mind], conversationHistoryByMind: { [mind.mindId]: [] } }}>
        <ConversationHistoryPanel autoCollapsed />
      </AppStateProvider>,
    );

    const history = screen.getByLabelText('Conversation history');
    expect(history.className).toContain('w-10');
    const expand = screen.getByRole('button', { name: 'Expand history panel' }) as HTMLButtonElement;
    expect(expand.disabled).toBe(true);
  });

  it('distinguishes no selected agent, loading history, and empty selected history', async () => {
    renderHistoryPanel({ activeMindId: null, minds: [] });
    expect(screen.getByText('Select an agent to see history')).toBeTruthy();
    expect(api.conversationHistory.list).not.toHaveBeenCalled();
    cleanup();

    renderHistoryPanel({ activeMindId: mind.mindId, minds: [mind] });
    expect(screen.getByText('Loading history...')).toBeTruthy();
    cleanup();

    (api.conversationHistory.list as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderHistoryPanel({ activeMindId: mind.mindId, minds: [mind] });
    expect(await screen.findByText('No conversations yet')).toBeTruthy();
  });

  it('does not retry a rejected automatic conversation resume for the same selected session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const conversation = makeConversation({ title: 'Locked chat' });
    (api.conversationHistory.resume as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Cannot switch conversations while a message is still streaming.'),
    );

    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
      activeConversationByMind: { [mind.mindId]: conversation.sessionId },
      conversationViewByMind: {
        [mind.mindId]: {
          status: 'idle',
          sessionId: conversation.sessionId,
          streaming: false,
          modelSwitching: false,
        },
      },
    });

    await waitFor(() => {
      expect(api.conversationHistory.resume).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(api.conversationHistory.resume).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole('alert')).textContent).toBe('Cannot switch conversations while a message is still streaming.');
    warn.mockRestore();
  });

  it('keeps the row overflow control visible for keyboard focus', () => {
    const conversation = makeConversation({ title: 'Planning thread' });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
      activeConversationByMind: { [mind.mindId]: conversation.sessionId },
      conversationViewByMind: { [mind.mindId]: { status: 'ready', sessionId: conversation.sessionId, streaming: false, modelSwitching: false } },
    });

    const overflow = screen.getByRole('button', { name: 'More actions for Planning thread' });

    expect(overflow.className).toContain('group-focus-within:opacity-100');
    expect(overflow.className).toContain('focus-visible:opacity-100');
    expect(screen.getByText(/just now/).className).toContain('text-xs');
  });

  it('groups the secondary row actions in the overflow menu and keeps pin inline (rail-H2)', () => {
    const conversation = makeConversation({ title: 'Planning thread', active: false });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
    });

    expect(screen.getByRole('button', { name: 'Pin Planning thread' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull();

    openRowMenu('Planning thread');

    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Export as Markdown' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Export as JSON' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Pin' })).toBeNull();
  });

  it('opens a right-click context menu exposing pin and the secondary actions (shell-F4/rail-H3)', () => {
    const conversation = makeConversation({ title: 'Planning thread', active: false });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
    });

    expect(screen.queryByRole('menuitem', { name: 'Pin' })).toBeNull();
    fireEvent.contextMenu(screen.getByText('Planning thread'));

    expect(screen.getByRole('menuitem', { name: 'Pin' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('shows source metadata for forked conversations', () => {
    const conversation = makeConversation({
      title: 'Follow-up idea',
      forkOf: {
        sourceSessionId: 'source-session',
        sourceEventId: 'evt-2',
        sourceMessageId: 'a1',
        sourceTitle: 'Planning thread',
        createdAt: '2026-05-05T22:10:00.000Z',
      },
    });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
      activeConversationByMind: { [mind.mindId]: conversation.sessionId },
      conversationViewByMind: { [mind.mindId]: { status: 'ready', sessionId: conversation.sessionId, streaming: false, modelSwitching: false } },
    });

    expect(screen.getByText('Follow-up idea')).toBeTruthy();
    expect(screen.getByText('Fork of Planning thread', { selector: '.truncate.text-xs' })).toBeTruthy();
  });

  it('confirms before deleting conversations with messages', async () => {
    const conversation = makeConversation({ title: 'Keep me honest', hasMessages: true });
    (api.conversationHistory.list as ReturnType<typeof vi.fn>).mockResolvedValue([conversation]);
    (api.conversationHistory.delete as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: conversation.sessionId,
      messages: [],
      conversations: [],
    });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
      activeConversationByMind: { [mind.mindId]: conversation.sessionId },
      conversationViewByMind: { [mind.mindId]: { status: 'ready', sessionId: conversation.sessionId, streaming: false, modelSwitching: false } },
    });

    openRowMenu('Keep me honest');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Delete "Keep me honest"?')).toBeTruthy();
    expect(api.conversationHistory.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));

    await waitFor(() => {
      expect(api.conversationHistory.delete).toHaveBeenCalledWith(mind.mindId, conversation.sessionId);
    });
  });

  it('deletes empty conversations without confirmation', async () => {
    const conversation = makeConversation({ title: 'Empty draft', hasMessages: false });
    (api.conversationHistory.list as ReturnType<typeof vi.fn>).mockResolvedValue([conversation]);
    (api.conversationHistory.delete as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: conversation.sessionId,
      messages: [],
      conversations: [],
    });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
      activeConversationByMind: { [mind.mindId]: conversation.sessionId },
      conversationViewByMind: { [mind.mindId]: { status: 'ready', sessionId: conversation.sessionId, streaming: false, modelSwitching: false } },
    });

    openRowMenu('Empty draft');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(api.conversationHistory.delete).toHaveBeenCalledWith(mind.mindId, conversation.sessionId);
    });
  });

  it('filters the conversation list by title as the user types', async () => {
    const roadmap = makeConversation({ sessionId: 's-roadmap', title: 'Q3 Roadmap', active: false });
    const standup = makeConversation({ sessionId: 's-standup', title: 'Daily standup', active: false });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [roadmap, standup] },
    });

    expect(screen.getByText('Q3 Roadmap')).toBeTruthy();
    expect(screen.getByText('Daily standup')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'roadmap' } });

    await waitFor(() => {
      expect(screen.queryByText('Daily standup')).toBeNull();
    });
    expect(screen.getByText('Q3 Roadmap')).toBeTruthy();
  });

  it('shows an empty state and restores the list when the search is cleared', async () => {
    const roadmap = makeConversation({ sessionId: 's-roadmap', title: 'Q3 Roadmap', active: false });
    const standup = makeConversation({ sessionId: 's-standup', title: 'Daily standup', active: false });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [roadmap, standup] },
    });

    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'zzz no match' } });

    await waitFor(() => {
      expect(screen.getByText('No conversations match your search')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Clear search'));

    await waitFor(() => {
      expect(screen.getByText('Daily standup')).toBeTruthy();
    });
    expect(screen.getByText('Q3 Roadmap')).toBeTruthy();
  });

  it('matches conversations by message content when the title does not match', async () => {
    const roadmap = makeConversation({ sessionId: 's-roadmap', title: 'Q3 Roadmap', active: false });
    const untitled = makeConversation({ sessionId: 's-bugfix', title: 'Untitled thread', active: false });
    (api.conversationHistory.messages as ReturnType<typeof vi.fn>).mockImplementation(
      (_mindId: string, sessionId: string) => Promise.resolve(
        sessionId === 's-bugfix'
          ? [{ id: 'u1', role: 'user', blocks: [{ type: 'text', content: 'SAML SSO login fails' }], timestamp: 1 }]
          : [],
      ),
    );
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [roadmap, untitled] },
    });

    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'saml' } });

    await waitFor(() => {
      expect(screen.queryByText('Q3 Roadmap')).toBeNull();
      expect(screen.getByText('Untitled thread')).toBeTruthy();
    });
    expect(api.conversationHistory.messages).toHaveBeenCalledWith(mind.mindId, 's-bugfix');
  });

  it('exports the selected conversation as Markdown through the save-dialog IPC', async () => {
    const conversation = makeConversation({ title: 'Planning thread' });
    (api.conversationHistory.export as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'saved',
      path: 'C:/tmp/planning.md',
      format: 'markdown',
    });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
      activeConversationByMind: { [mind.mindId]: conversation.sessionId },
      conversationViewByMind: { [mind.mindId]: { status: 'ready', sessionId: conversation.sessionId, streaming: false, modelSwitching: false } },
    });

    openRowMenu('Planning thread');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Export as Markdown' }));

    await waitFor(() => {
      expect(api.conversationHistory.export).toHaveBeenCalledWith(mind.mindId, conversation.sessionId, 'markdown');
    });
  });

  it('exports the selected conversation as JSON through the save-dialog IPC', async () => {
    const conversation = makeConversation({ title: 'Planning thread' });
    (api.conversationHistory.export as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'saved',
      path: 'C:/tmp/planning.json',
      format: 'json',
    });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
      activeConversationByMind: { [mind.mindId]: conversation.sessionId },
      conversationViewByMind: { [mind.mindId]: { status: 'ready', sessionId: conversation.sessionId, streaming: false, modelSwitching: false } },
    });

    openRowMenu('Planning thread');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Export as JSON' }));

    await waitFor(() => {
      expect(api.conversationHistory.export).toHaveBeenCalledWith(mind.mindId, conversation.sessionId, 'json');
    });
  });

  it('pins a conversation to the top and calls the pin IPC', async () => {
    const alpha = makeConversation({ sessionId: 's-alpha', title: 'Alpha', active: false });
    const bravo = makeConversation({ sessionId: 's-bravo', title: 'Bravo', active: false });
    (api.conversationHistory.setPinned as ReturnType<typeof vi.fn>).mockResolvedValue([
      alpha,
      { ...bravo, isPinned: true },
    ]);
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [alpha, bravo] },
    });

    expect(orderedResumeTitles()).toEqual(['Alpha', 'Bravo']);

    fireEvent.click(screen.getByRole('button', { name: 'Pin Bravo' }));

    await waitFor(() => {
      expect(api.conversationHistory.setPinned).toHaveBeenCalledWith(mind.mindId, 's-bravo', true);
    });
    await waitFor(() => {
      expect(orderedResumeTitles()).toEqual(['Bravo', 'Alpha']);
    });
    expect(screen.getByText('Pinned')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unpin Bravo' })).toBeTruthy();
  });

  it('archives a conversation into a collapsed section and restores it on unarchive', async () => {
    const alpha = makeConversation({ sessionId: 's-alpha', title: 'Alpha', active: false });
    const bravo = makeConversation({ sessionId: 's-bravo', title: 'Bravo', active: false });
    (api.conversationHistory.setArchived as ReturnType<typeof vi.fn>).mockResolvedValue([
      alpha,
      { ...bravo, isArchived: true },
    ]);
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [alpha, bravo] },
    });

    openRowMenu('Bravo');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));

    await waitFor(() => {
      expect(api.conversationHistory.setArchived).toHaveBeenCalledWith(mind.mindId, 's-bravo', true);
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Archived \(1\)/ })).toBeTruthy();
    });
    expect(screen.queryByText('Bravo')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Archived \(1\)/ }));

    expect(screen.getByText('Bravo')).toBeTruthy();
    openRowMenu('Bravo');
    expect(screen.getByRole('menuitem', { name: 'Unarchive' })).toBeTruthy();
  });

  it('keeps organization actions available for keyboard focus with honest labels', () => {
    const conversation = makeConversation({ title: 'Planning thread', active: false });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
    });

    const pin = screen.getByRole('button', { name: 'Pin Planning thread' });
    const overflow = screen.getByRole('button', { name: 'More actions for Planning thread' });

    expect(pin.className).toContain('group-focus-within:opacity-100');
    expect(overflow.className).toContain('group-focus-within:opacity-100');
    expect(overflow.className).toContain('focus-visible:opacity-100');
  });

  it('reveals matching archived conversations while searching and restores the collapsed state when cleared', async () => {
    const active = makeConversation({ sessionId: 's-active', title: 'Active plan', active: false });
    const archived = makeConversation({ sessionId: 's-archived', title: 'Archived plan', active: false, isArchived: true });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [active, archived] },
    });

    expect(screen.queryByText('Archived plan')).toBeNull();
    expect(screen.getByRole('button', { name: /Archived \(1\)/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'archived' } });

    await waitFor(() => {
      expect(screen.getByText('Archived plan')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Clear search'));

    await waitFor(() => {
      expect(screen.queryByText('Archived plan')).toBeNull();
    });
  });

  it('hides the archived disclosure when the search matches no archived conversations', async () => {
    const active = makeConversation({ sessionId: 's-active', title: 'Active plan', active: false });
    const archived = makeConversation({ sessionId: 's-archived', title: 'Archived plan', active: false, isArchived: true });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [active, archived] },
    });

    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'active' } });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Archived \(/ })).toBeNull();
    });
    expect(screen.getByText('Active plan')).toBeTruthy();
  });

  it('virtualizes the regular conversation list past the windowing threshold (rail-H8)', () => {
    // Drive the windowing hook's rAF-throttled scroll read synchronously.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const conversations = Array.from({ length: 80 }, (_, i) =>
        makeConversation({ sessionId: `session-${i}`, title: `Conversation ${i}`, active: false }),
      );

      const { container } = render(
        <AppStateProvider
          testInitialState={{
            activeMindId: mind.mindId,
            minds: [mind],
            conversationHistoryByMind: { [mind.mindId]: conversations },
          }}
        >
          <ConversationHistoryPanel />
        </AppStateProvider>,
      );

      const scroller = container.querySelector('.overflow-y-auto') as HTMLDivElement;
      Object.defineProperty(scroller, 'clientHeight', { value: 600, configurable: true });

      act(() => {
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event('scroll'));
      });

      const rendered = screen.getAllByRole('button', { name: /^Resume Conversation / });
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.length).toBeLessThan(40);
      expect(screen.queryByRole('button', { name: 'Resume Conversation 0' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Resume Conversation 79' })).toBeNull();
      expect(container.querySelector('[data-window-key="session-0"]')).toBeTruthy();
      expect(container.querySelector('[data-window-spacer="bottom"]')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function renderHistoryPanel(testInitialState?: Partial<AppState>) {
  render(
    <AppStateProvider testInitialState={testInitialState}>
      <ConversationHistoryPanel />
    </AppStateProvider>,
  );
}

function orderedResumeTitles(): string[] {
  return screen
    .getAllByRole('button', { name: /^Resume / })
    .map((button) => (button.getAttribute('aria-label') ?? '').replace(/^Resume /, ''));
}

function makeConversation(overrides?: Partial<ConversationSummary>): ConversationSummary {
  const now = new Date().toISOString();
  return {
    sessionId: 'session-1',
    title: 'Planning thread',
    createdAt: now,
    updatedAt: now,
    kind: 'chat',
    active: true,
    hasMessages: true,
    ...overrides,
  };
}
