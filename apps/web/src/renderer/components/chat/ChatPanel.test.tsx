/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, MindContext } from '@chamber/shared/types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { ChatPanel } from './ChatPanel';

// The transcript, composer, and welcome surfaces are exercised by their own
// specs; stub them so this spec isolates the inline error/Retry wiring.
vi.mock('./MessageList', () => ({ MessageList: () => <div data-testid="message-list" /> }));
vi.mock('./ChatInput', () => ({ ChatInput: () => <div data-testid="chat-input" /> }));
vi.mock('./WelcomeScreen', () => ({ WelcomeScreen: () => <div data-testid="welcome-screen" /> }));
vi.mock('./AgentWelcome', () => ({ AgentWelcome: () => <div data-testid="agent-welcome" /> }));
vi.mock('./ChatSystemPromptControl', () => ({ ChatSystemPromptControl: () => null }));

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\agents\\monica',
  identity: { name: 'Monica', systemMessage: '# Monica' },
  status: 'ready',
};

function conversationHistory() {
  return [{ sessionId: 's1', title: 'Chat', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), kind: 'chat' as const, active: true }];
}

function transcript(): ChatMessage[] {
  return [
    { id: 'u1', role: 'user', blocks: [{ type: 'text', content: 'hello' }], timestamp: 1, eventId: 'evt-1' },
    { id: 'a1', role: 'assistant', blocks: [], timestamp: 2, isStreaming: false },
  ];
}

function baseState(overrides?: Partial<AppState>): Partial<AppState> {
  return {
    minds: [mind],
    activeMindId: 'mind-1',
    messagesByMind: { 'mind-1': transcript() },
    conversationHistoryByMind: { 'mind-1': conversationHistory() },
    conversationViewByMind: { 'mind-1': { status: 'ready', sessionId: 's1', streaming: false, modelSwitching: false } },
    ...overrides,
  };
}

function renderPanel(api = mockElectronAPI(), overrides?: Partial<AppState>) {
  installElectronAPI(api);
  render(
    <AppStateProvider testInitialState={baseState(overrides)}>
      <ChatPanel />
    </AppStateProvider>,
  );
  return api;
}

describe('ChatPanel error surface', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders no error alert when the active mind has no error', () => {
    renderPanel();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders an inline alert with the mind error and a Retry action', () => {
    renderPanel(mockElectronAPI(), {
      errorByMind: { 'mind-1': { message: 'The agent finished without a response.', failedMessageId: 'a1' } },
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The agent finished without a response.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('does not surface another mind\'s error for the active mind', () => {
    renderPanel(mockElectronAPI(), {
      errorByMind: { 'mind-2': { message: 'other mind failure', failedMessageId: 'x1' } },
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows practical header context cues for the active conversation and model', () => {
    renderPanel(mockElectronAPI(), {
      selectedModel: 'copilot:gpt-5.6-sol',
      availableModels: [{ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }],
      conversationHistoryByMind: {
        'mind-1': [{ ...conversationHistory()[0], title: 'Shipping UX fixes' }],
      },
    });

    expect(screen.getByText('Shipping UX fixes')).toBeTruthy();
    expect(
      screen.getByText((value) => value.includes('Monica') && value.includes('GPT-5.6 Sol')),
    ).toBeTruthy();
  });

  it('re-runs the failed turn through the regenerate path when Retry is clicked', async () => {
    const api = renderPanel(mockElectronAPI(), {
      errorByMind: { 'mind-1': { message: 'The agent ran into an error.', failedMessageId: 'a1' } },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(api.chat.regenerate).toHaveBeenCalledWith('mind-1', expect.any(String), undefined);
    });
  });
});
