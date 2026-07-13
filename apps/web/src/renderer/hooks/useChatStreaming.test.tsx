/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { AppStateProvider, useAppDispatch, useAppState } from '../lib/store';
import type { AppState } from '../lib/store/state';
import type { ChatMessage, MessageVariantGroup } from '@chamber/shared/types';
import { installElectronAPI, mockElectronAPI } from '../../test/helpers';
import { useChatStreaming } from './useChatStreaming';

function wrapper(testInitialState?: Partial<AppState>) {
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return <AppStateProvider testInitialState={testInitialState}>{children}</AppStateProvider>;
  };
}

const MIND = {
  mindId: 'monica-1234',
  mindPath: 'C:\\agents\\monica',
  identity: { name: 'Monica', systemMessage: '' },
  status: 'ready' as const,
};

function user(id: string, text: string, eventId?: string): ChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', content: text }], timestamp: 0, ...(eventId ? { eventId } : {}) };
}

function assistant(id: string, text: string, eventId?: string): ChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', content: text }], timestamp: 0, ...(eventId ? { eventId } : {}) };
}

function frozenGroup(): MessageVariantGroup {
  return {
    groupId: 'g1',
    anchorEventId: null,
    frozenVariants: [{ variantId: 'v1', createdAt: '2024-01-01T00:00:00.000Z', messages: [user('u1', 'old prompt'), assistant('a1', 'old answer')] }],
  };
}

describe('useChatStreaming', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
  });

  it('sendMessage no-ops when no active mind', async () => {
    const { result } = renderHook(() => useChatStreaming(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    // No active mind → no-op
    expect(api.chat.send).not.toHaveBeenCalled();
  });

  it('sendMessage no-ops on empty string', async () => {
    const { result } = renderHook(() => useChatStreaming(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.sendMessage('   ');
    });

    expect(api.chat.send).not.toHaveBeenCalled();
  });

  it('stopStreaming no-ops when no active mind', async () => {
    const { result } = renderHook(() => useChatStreaming(), { wrapper: wrapper() });

    await act(async () => {
      await result.current.stopStreaming();
    });

    expect(api.chat.stop).not.toHaveBeenCalled();
  });

  it('isStreaming reflects state', () => {
    const { result } = renderHook(() => useChatStreaming(), { wrapper: wrapper() });
    expect(result.current.isStreaming).toBe(false);
  });

  it('sendMessage no-ops while the active mind is switching models', async () => {
    const mind = {
      mindId: 'monica-1234',
      mindPath: 'C:\\agents\\monica',
      identity: { name: 'Monica', systemMessage: '' },
      status: 'ready' as const,
    };
    const { result } = renderHook(() => useChatStreaming(), {
      wrapper: wrapper({
        minds: [mind],
        activeMindId: mind.mindId,
        conversationViewByMind: {
          [mind.mindId]: {
            status: 'ready',
            sessionId: 'session-1',
            streaming: false,
            modelSwitching: true,
          },
        },
      }),
    });

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(api.chat.send).not.toHaveBeenCalled();
    expect(result.current.isBusy).toBe(true);
  });

  it('stops the original streaming mind after switching away and back', async () => {
    let resolveSend: () => void = () => undefined;
    (api.chat.send as ReturnType<typeof vi.fn>).mockReturnValue(new Promise<void>((resolve) => {
      resolveSend = resolve;
    }));
    const firstMind = {
      mindId: 'monica-1234',
      mindPath: 'C:\\agents\\monica',
      identity: { name: 'Monica', systemMessage: '' },
      status: 'ready' as const,
    };
    const secondMind = {
      mindId: 'q-1234',
      mindPath: 'C:\\agents\\q',
      identity: { name: 'Q', systemMessage: '' },
      status: 'ready' as const,
    };
    const { result } = renderHook(() => ({
      chat: useChatStreaming(),
      dispatch: useAppDispatch(),
    }), {
      wrapper: wrapper({ minds: [firstMind, secondMind], activeMindId: firstMind.mindId }),
    });

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.chat.sendMessage('Hello');
      await Promise.resolve();
    });
    const messageId = (api.chat.send as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;

    act(() => {
      result.current.dispatch({ type: 'SET_ACTIVE_MIND', payload: secondMind.mindId });
    });
    act(() => {
      result.current.dispatch({ type: 'SET_ACTIVE_MIND', payload: firstMind.mindId });
    });
    await act(async () => {
      await result.current.chat.stopStreaming();
    });

    expect(api.chat.stop).toHaveBeenCalledWith(firstMind.mindId, messageId);
    await act(async () => {
      resolveSend();
      await sendPromise;
    });
  });

  describe('retained versions', () => {
    it('captures the current tail as a variant before truncating on regenerate', async () => {
      const live = [user('u2', 'question', 'e1'), assistant('a2', 'new answer', 'e2')];
      const { result } = renderHook(() => ({ chat: useChatStreaming(), state: useAppState() }), {
        wrapper: wrapper({ minds: [MIND], activeMindId: MIND.mindId, messagesByMind: { [MIND.mindId]: live } }),
      });

      await act(async () => {
        await result.current.chat.regenerate();
      });

      const groups = result.current.state.variantGroupsByMind[MIND.mindId] ?? [];
      expect(groups).toHaveLength(1);
      expect(groups[0].frozenVariants[0].messages.map((m) => m.id)).toEqual(['u2', 'a2']);
      expect(api.chat.regenerate).toHaveBeenCalled();
    });

    it('captures the current tail as a variant before truncating on edit', async () => {
      const live = [user('u2', 'question', 'e1'), assistant('a2', 'answer', 'e2')];
      const { result } = renderHook(() => ({ chat: useChatStreaming(), state: useAppState() }), {
        wrapper: wrapper({ minds: [MIND], activeMindId: MIND.mindId, messagesByMind: { [MIND.mindId]: live } }),
      });

      await act(async () => {
        await result.current.chat.editAndResubmit(live[0], 'edited question');
      });

      const groups = result.current.state.variantGroupsByMind[MIND.mindId] ?? [];
      expect(groups).toHaveLength(1);
      expect(groups[0].frozenVariants[0].messages.map((m) => m.id)).toEqual(['u2', 'a2']);
      expect(api.chat.editMessage).toHaveBeenCalledWith(MIND.mindId, 'e1', 'edited question', expect.any(String), undefined);
    });

    it('promotes the selected version before sending when a frozen branch is viewed', async () => {
      const live = [user('u2', 'question', 'e1'), assistant('a2', 'new answer', 'e2')];
      (api.chat.switchActiveVariant as ReturnType<typeof vi.fn>).mockResolvedValue({
        sessionId: 'session-1',
        messages: [user('u1', 'old prompt', 'e1'), assistant('a1', 'old answer', 'e2')],
        conversations: [],
      });
      const { result } = renderHook(() => useChatStreaming(), {
        wrapper: wrapper({
          minds: [MIND],
          activeMindId: MIND.mindId,
          messagesByMind: { [MIND.mindId]: live },
          variantGroupsByMind: { [MIND.mindId]: [frozenGroup()] },
          variantSelectionByMind: { [MIND.mindId]: { g1: 0 } },
        }),
      });

      await act(async () => {
        await result.current.sendMessage('continue from the old version');
      });

      expect(api.chat.switchActiveVariant).toHaveBeenCalledWith(MIND.mindId, null, 'v1');
      expect(api.chat.send).toHaveBeenCalled();
      const switchOrder = (api.chat.switchActiveVariant as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      const sendOrder = (api.chat.send as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
      expect(switchOrder).toBeLessThan(sendOrder);
    });

    it('does not promote when the active branch is selected', async () => {
      const live = [user('u2', 'question', 'e1'), assistant('a2', 'new answer', 'e2')];
      const { result } = renderHook(() => useChatStreaming(), {
        wrapper: wrapper({
          minds: [MIND],
          activeMindId: MIND.mindId,
          messagesByMind: { [MIND.mindId]: live },
          variantGroupsByMind: { [MIND.mindId]: [frozenGroup()] },
          variantSelectionByMind: { [MIND.mindId]: { g1: 1 } },
        }),
      });

      await act(async () => {
        await result.current.sendMessage('continue on the live branch');
      });

      expect(api.chat.switchActiveVariant).not.toHaveBeenCalled();
      expect(api.chat.send).toHaveBeenCalled();
    });
  });

  describe('model override', () => {
    it('regenerates with the mind current model when no override is given', async () => {
      const live = [user('u2', 'question', 'e1'), assistant('a2', 'answer', 'e2')];
      const { result } = renderHook(() => useChatStreaming(), {
        wrapper: wrapper({ minds: [MIND], activeMindId: MIND.mindId, selectedModel: 'copilot:model-1', messagesByMind: { [MIND.mindId]: live } }),
      });

      await act(async () => {
        await result.current.regenerate();
      });

      expect(api.chat.regenerate).toHaveBeenCalledWith(MIND.mindId, expect.any(String), 'copilot:model-1');
      expect(api.mind.setModel).not.toHaveBeenCalled();
    });

    it('regenerates one-shot with a chosen model without persisting the selection', async () => {
      const live = [user('u2', 'question', 'e1'), assistant('a2', 'answer', 'e2')];
      const { result } = renderHook(() => ({ chat: useChatStreaming(), state: useAppState() }), {
        wrapper: wrapper({ minds: [MIND], activeMindId: MIND.mindId, selectedModel: 'copilot:model-1', messagesByMind: { [MIND.mindId]: live } }),
      });

      await act(async () => {
        await result.current.chat.regenerate('copilot:model-2');
      });

      expect(api.chat.regenerate).toHaveBeenCalledWith(MIND.mindId, expect.any(String), 'copilot:model-2');
      expect(api.mind.setModel).not.toHaveBeenCalled();
      expect(result.current.state.selectedModel).toBe('copilot:model-1');
      const groups = result.current.state.variantGroupsByMind[MIND.mindId] ?? [];
      expect(groups).toHaveLength(1);
    });
  });
});
