/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary, MindContext } from '@chamber/shared/types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { ChatSystemPromptControl } from './ChatSystemPromptControl';

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\agents\\monica',
  identity: { name: 'Monica', systemMessage: '# Monica default' },
  status: 'ready',
};

function makeConversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    sessionId: 'session-1',
    title: 'Planning',
    createdAt: '2026-05-05T22:00:00.000Z',
    updatedAt: '2026-05-05T22:15:00.000Z',
    kind: 'chat',
    active: true,
    hasMessages: true,
    ...overrides,
  };
}

function renderControl(state: Partial<AppState>, props: { disabled?: boolean } = {}) {
  return render(
    <AppStateProvider testInitialState={state}>
      <ChatSystemPromptControl {...props} />
    </AppStateProvider>,
  );
}

describe('ChatSystemPromptControl', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the agent default state when the conversation has no override', () => {
    renderControl({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [makeConversation()] },
    });

    const trigger = screen.getByRole('button', { name: 'Conversation system prompt' });
    expect(trigger.textContent).toContain('Agent default');
  });

  it('shows the custom state when the conversation has an override', () => {
    renderControl({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [makeConversation({ systemMessage: 'Only speak in haiku.' })] },
    });

    expect(screen.getByRole('button', { name: 'Conversation system prompt' }).textContent).toContain('Custom prompt');
  });

  it('opens the dialog with the current override prefilled and the agent default as placeholder', () => {
    renderControl({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [makeConversation({ systemMessage: 'Only speak in haiku.' })] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Conversation system prompt' }));

    const textarea = screen.getByLabelText('System prompt for this conversation') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Only speak in haiku.');
    expect(textarea.placeholder).toBe('# Monica default');
  });

  it('saves a new override and reflects the refreshed summaries from the host', async () => {
    const refreshed: ConversationSummary[] = [makeConversation({ systemMessage: 'Be terse.', updatedAt: '2026-05-05T23:00:00.000Z' })];
    (api.conversationHistory.setSystemMessage as ReturnType<typeof vi.fn>).mockResolvedValue(refreshed);

    renderControl({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [makeConversation()] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Conversation system prompt' }));
    fireEvent.change(screen.getByLabelText('System prompt for this conversation'), { target: { value: 'Be terse.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(api.conversationHistory.setSystemMessage).toHaveBeenCalledWith('mind-1', 'session-1', 'Be terse.');
    });
    expect(screen.getByRole('button', { name: 'Conversation system prompt' }).textContent).toContain('Custom prompt');
  });

  it('clears the override through reset and falls back to the agent default', async () => {
    const refreshed: ConversationSummary[] = [makeConversation({ updatedAt: '2026-05-05T23:00:00.000Z' })];
    (api.conversationHistory.setSystemMessage as ReturnType<typeof vi.fn>).mockResolvedValue(refreshed);

    renderControl({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [makeConversation({ systemMessage: 'Only speak in haiku.' })] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Conversation system prompt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to agent default' }));

    await waitFor(() => {
      expect(api.conversationHistory.setSystemMessage).toHaveBeenCalledWith('mind-1', 'session-1', '');
    });
    expect(screen.getByRole('button', { name: 'Conversation system prompt' }).textContent).toContain('Agent default');
  });

  it('disables the trigger while a turn is streaming or the mind is busy', () => {
    renderControl(
      {
        activeMindId: mind.mindId,
        minds: [mind],
        conversationHistoryByMind: { [mind.mindId]: [makeConversation()] },
      },
      { disabled: true },
    );

    const trigger = screen.getByRole('button', { name: 'Conversation system prompt' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);

    fireEvent.click(trigger);

    expect(screen.queryByLabelText('System prompt for this conversation')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('renders nothing when there is no active conversation', () => {
    const { container } = renderControl({
      activeMindId: mind.mindId,
      minds: [mind],
      conversationHistoryByMind: { [mind.mindId]: [] },
    });

    expect(container.querySelector('button')).toBeNull();
  });
});
