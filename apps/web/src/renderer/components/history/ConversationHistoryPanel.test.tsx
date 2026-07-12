/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary, MindContext } from '@chamber/shared/types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { ConversationHistoryPanel } from './ConversationHistoryPanel';

const STORAGE_KEY = 'chamber:conversation-history-collapsed';

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

  it('keeps row actions visible for keyboard focus', () => {
    const conversation = makeConversation({ title: 'Planning thread' });
    renderHistoryPanel({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [conversation] },
      activeConversationByMind: { [mind.mindId]: conversation.sessionId },
      conversationViewByMind: { [mind.mindId]: { status: 'ready', sessionId: conversation.sessionId, streaming: false, modelSwitching: false } },
    });

    const rename = screen.getByRole('button', { name: 'Rename Planning thread' });
    const deleteButton = screen.getByRole('button', { name: 'Delete Planning thread' });

    expect(rename.className).toContain('group-focus-within:opacity-100');
    expect(rename.className).toContain('focus-visible:opacity-100');
    expect(deleteButton.className).toContain('group-focus-within:opacity-100');
    expect(deleteButton.className).toContain('focus-visible:opacity-100');
    expect(screen.getByText(/just now/).className).toContain('text-xs');
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

    fireEvent.click(screen.getByRole('button', { name: 'Delete Keep me honest' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'Delete Empty draft' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'Export Planning thread' }));
    fireEvent.click(await screen.findByText('Export as Markdown'));

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

    fireEvent.click(screen.getByRole('button', { name: 'Export Planning thread' }));
    fireEvent.click(await screen.findByText('Export as JSON'));

    await waitFor(() => {
      expect(api.conversationHistory.export).toHaveBeenCalledWith(mind.mindId, conversation.sessionId, 'json');
    });
  });
});

function renderHistoryPanel(testInitialState?: Partial<AppState>) {
  render(
    <AppStateProvider testInitialState={testInitialState}>
      <ConversationHistoryPanel />
    </AppStateProvider>,
  );
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
