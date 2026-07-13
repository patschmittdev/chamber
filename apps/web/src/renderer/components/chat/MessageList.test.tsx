/** @vitest-environment jsdom */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppStateProvider, useAppDispatch } from '../../lib/store';
import { MessageList } from './MessageList';
import type { ChatMessage, MindContext, MessageVariantGroup, ModelInfo } from '@chamber/shared/types';
import { installCmdkDom, installElectronAPI } from '../../../test/helpers';

installCmdkDom();

const Q: MindContext = {
  mindId: 'q',
  mindPath: 'C:\\minds\\q',
  identity: { name: 'Q', systemMessage: 'Quartermaster' },
  status: 'ready',
};

const MONEYPENNY: MindContext = {
  mindId: 'moneypenny',
  mindPath: 'C:\\minds\\moneypenny',
  identity: { name: 'Miss Moneypenny', systemMessage: 'Secretary' },
  status: 'ready',
};

function renderMessages(messages: ChatMessage[]) {
  return render(
    <AppStateProvider
      testInitialState={{
        activeMindId: MONEYPENNY.mindId,
        minds: [Q, MONEYPENNY],
        messagesByMind: { [MONEYPENNY.mindId]: messages },
      }}
    >
      <MessageList />
    </AppStateProvider>,
  );
}

function renderWithModels(messages: ChatMessage[], models: ModelInfo[], selectedModel: string) {
  return render(
    <AppStateProvider
      testInitialState={{
        activeMindId: MONEYPENNY.mindId,
        minds: [MONEYPENNY],
        messagesByMind: { [MONEYPENNY.mindId]: messages },
        availableModels: models,
        selectedModel,
      }}
    >
      <MessageList />
    </AppStateProvider>,
  );
}

function modelInfo(id: string, name: string): ModelInfo {
  return { id, name };
}

function modelOption(name: string): HTMLElement {
  const items = Array.from(document.querySelectorAll('[data-slot="command-item"]')) as HTMLElement[];
  const match = items.find((el) => el.textContent?.includes(name));
  if (!match) throw new Error(`No model option matching ${name}`);
  return match;
}

describe('MessageList', () => {
  let api: ReturnType<typeof installElectronAPI>;

  beforeEach(() => {
    api = installElectronAPI();
  });

  it('regenerates one-shot with a chosen model from the message action submenu', async () => {
    renderWithModels(
      [
        { id: 'u1', role: 'user', blocks: [{ type: 'text', content: 'ask' }], timestamp: 1, eventId: 'evt-u1' },
        { id: 'a1', role: 'assistant', blocks: [{ type: 'text', content: 'answer' }], timestamp: 2, eventId: 'evt-a1' },
      ],
      [modelInfo('model-1', 'Model 1'), modelInfo('model-2', 'Model 2')],
      'copilot:model-1',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate with a different model' }));
    fireEvent.click(modelOption('Model 2'));

    await waitFor(() => {
      expect(api.chat.regenerate).toHaveBeenCalledWith(MONEYPENNY.mindId, expect.any(String), 'copilot:model-2');
    });
    expect(api.mind.setModel).not.toHaveBeenCalled();
  });

  it('renders A2A user messages with the sending agent attribution', () => {
    renderMessages([
      {
        id: 'a2a-1',
        role: 'user',
        blocks: [{ type: 'text', content: 'Please inspect this file.' }],
        timestamp: 1000,
        sender: { mindId: Q.mindId, name: Q.identity.name },
      },
    ]);

    expect(screen.getAllByText('Q').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('You')).toBeNull();
    expect(screen.getByText('Please inspect this file.')).toBeTruthy();
  });

  it('keeps directly authored user messages attributed to You', () => {
    renderMessages([
      {
        id: 'user-1',
        role: 'user',
        blocks: [{ type: 'text', content: 'Hello directly.' }],
        timestamp: 1000,
      },
    ]);

    expect(screen.getAllByText('You').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Hello directly.')).toBeTruthy();
  });

  it('collapses an SDK skill-context injection into a chip instead of dumping the block', () => {
    renderMessages([
      {
        id: 'skill-1',
        role: 'user',
        blocks: [{ type: 'text', content: '<skill-context name="lens">\n# Lens\nlong documentation body\n</skill-context>' }],
        timestamp: 1000,
      },
    ]);

    expect(screen.getByText('Loaded skill: lens')).toBeTruthy();
    expect(screen.queryByText(/long documentation body/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Loaded skill: lens/ }));
    expect(screen.getByText(/long documentation body/)).toBeTruthy();
  });

  it('renders the saved user profile avatar for directly authored messages', async () => {
    const api = installElectronAPI();
    (api.userProfile.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      displayName: 'Ian Philpot',
      work: 'Principal SWE Manager',
      location: 'Atlanta',
      about: '',
      avatarDataUrl: 'data:image/png;base64,aWFu',
      source: 'microsoft',
      microsoftAccount: 'ianphil@microsoft.com',
      updatedAt: '2026-05-09T00:00:00.000Z',
    });

    renderMessages([
      {
        id: 'user-avatar-1',
        role: 'user',
        blocks: [{ type: 'text', content: 'Hello with avatar.' }],
        timestamp: 1000,
      },
    ]);

    await waitFor(() => {
      expect(screen.getByAltText('You avatar')).toHaveProperty('src', 'data:image/png;base64,aWFu');
    });
    expect(screen.getByText('Hello with avatar.')).toBeTruthy();
  });

  it('falls back when an A2A sender name is blank', () => {
    renderMessages([
      {
        id: 'a2a-blank',
        role: 'user',
        blocks: [{ type: 'text', content: 'Blank sender.' }],
        timestamp: 1000,
        sender: { mindId: Q.mindId, name: '   ' },
      },
    ]);

    expect(screen.getAllByText('Unknown Agent').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Blank sender.')).toBeTruthy();
  });

  it('renders document attachment chips without exposing payload content', () => {
    renderMessages([
      {
        id: 'user-doc',
        role: 'user',
        blocks: [
          {
            type: 'attachment',
            id: 'att-1',
            kind: 'document',
            displayName: 'notes.txt',
            mimeType: 'text/plain',
            size: 11,
          },
          { type: 'text', content: 'Summarize this.' },
        ],
        timestamp: 1000,
      },
    ]);

    expect(screen.getByText('notes.txt')).toBeTruthy();
    expect(screen.getByText('text/plain')).toBeTruthy();
    expect(screen.getByText('11 B')).toBeTruthy();
    expect(screen.getByText('Summarize this.')).toBeTruthy();
    expect(screen.queryByText('hello world')).toBeNull();
  });


  it('renders the active agent profile avatar for assistant messages', async () => {
    const api = installElectronAPI();
    (api.mindProfile.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      mindId: MONEYPENNY.mindId,
      mindPath: MONEYPENNY.mindPath,
      displayName: 'Moneypenny',
      folderName: 'moneypenny',
      avatarDataUrl: 'data:image/png;base64,bW9uZXlwZW5ueQ==',
      accentColor: null,
      soul: { kind: 'soul', label: 'SOUL.md', relativePath: 'SOUL.md', content: '', exists: true, mtimeMs: 1 },
      agentFiles: [],
      needsRestart: false,
    });

    renderMessages([
      {
        id: 'assistant-1',
        role: 'assistant',
        blocks: [{ type: 'text', content: 'At your service.' }],
        timestamp: 1000,
      },
    ]);

    await waitFor(() => {
      expect(screen.getByAltText('Moneypenny avatar')).toHaveProperty('src', 'data:image/png;base64,bW9uZXlwZW5ueQ==');
    });
    expect(screen.getByText('Moneypenny')).toBeTruthy();
  });

  it('snaps to bottom when a user message arrives even after the user scrolled up', () => {
    // Use useAppDispatch to mutate state from inside the same Provider so the
    // MessageList instance (and its scroller ref) survives the change.
    const Harness = () => {
      const dispatch = useAppDispatch();
      return (
        <>
          <button onClick={() => dispatch({
            type: 'ADD_USER_MESSAGE',
            payload: { id: 'user-new', content: 'Just sent this', timestamp: 9999 },
          })}>send</button>
          <MessageList />
        </>
      );
    };

    const initial: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
      id: `asst-${i}`,
      role: 'assistant' as const,
      blocks: [{ type: 'text', content: `Reply ${i} `.repeat(40) }],
      timestamp: 1000 + i,
    }));

    const { container } = render(
      <AppStateProvider
        testInitialState={{
          activeMindId: MONEYPENNY.mindId,
          minds: [Q, MONEYPENNY],
          messagesByMind: { [MONEYPENNY.mindId]: initial },
        }}
      >
        <Harness />
      </AppStateProvider>,
    );

    const scroller = container.querySelector('.overflow-y-auto') as HTMLDivElement;
    expect(scroller).toBeTruthy();
    // Simulate the scroller geometry + a user scrolled up.
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
    scroller.scrollTop = 100;
    scroller.dispatchEvent(new Event('scroll'));
    expect(scroller.scrollTop).toBe(100);

    // User clicks send. Even though they're scrolled away from the bottom,
    // the new user message must snap them back so they see what they wrote.
    act(() => {
      fireEvent.click(screen.getByText('send'));
    });
    expect(scroller.scrollTop).toBe(2000);
  });

  it('surfaces a "New messages" pill when an assistant message arrives while the user is scrolled up', () => {
    const Harness = () => {
      const dispatch = useAppDispatch();
      return (
        <>
          <button onClick={() => dispatch({
            type: 'ADD_ASSISTANT_MESSAGE',
            payload: { id: 'asst-new', timestamp: 9999 },
          })}>add-assistant</button>
          <MessageList />
        </>
      );
    };

    const initial: ChatMessage[] = Array.from({ length: 5 }, (_, i) => ({
      id: `asst-${i}`,
      role: 'assistant' as const,
      blocks: [{ type: 'text', content: `Reply ${i}` }],
      timestamp: 1000 + i,
    }));

    const { container } = render(
      <AppStateProvider
        testInitialState={{
          activeMindId: MONEYPENNY.mindId,
          minds: [Q, MONEYPENNY],
          messagesByMind: { [MONEYPENNY.mindId]: initial },
        }}
      >
        <Harness />
      </AppStateProvider>,
    );

    const scroller = container.querySelector('.overflow-y-auto') as HTMLDivElement;
    expect(scroller).toBeTruthy();
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });
    scroller.scrollTop = 100;
    scroller.dispatchEvent(new Event('scroll'));

    // No pill before a new message arrives.
    expect(screen.queryByLabelText('Jump to latest message')).toBeNull();

    act(() => {
      fireEvent.click(screen.getByText('add-assistant'));
    });

    const pill = screen.getByLabelText('Jump to latest message');
    expect(pill).toBeTruthy();

    // Clicking the pill snaps to the bottom and the pill disappears.
    act(() => {
      fireEvent.click(pill);
    });
    expect(scroller.scrollTop).toBe(2000);
    expect(screen.queryByLabelText('Jump to latest message')).toBeNull();
  });

  describe('message action gating', () => {
    function query(name: RegExp | string) {
      return screen.queryByRole('button', { name }) as HTMLButtonElement | null;
    }

    it('disables Edit for a saved user turn that mixes text and an image', () => {
      renderMessages([
        {
          id: 'u-mixed',
          role: 'user',
          eventId: 'evt-mixed',
          blocks: [
            { type: 'image', name: 'shot.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,aaa' },
            { type: 'text', content: 'What is this?' },
          ],
          timestamp: 1000,
        },
      ]);

      const edit = query('Edit message');
      expect(edit).not.toBeNull();
      expect(edit?.disabled).toBe(true);
      expect(edit?.title).toMatch(/attachments/i);
    });

    it('disables Edit for a saved user turn with a document attachment', () => {
      renderMessages([
        {
          id: 'u-doc',
          role: 'user',
          eventId: 'evt-doc',
          blocks: [
            {
              type: 'attachment',
              id: 'att-1',
              kind: 'document',
              displayName: 'notes.txt',
              mimeType: 'text/plain',
              size: 11,
            },
            { type: 'text', content: 'What is this?' },
          ],
          timestamp: 1000,
        },
      ]);

      const edit = query('Edit message');
      expect(edit).not.toBeNull();
      expect(edit?.disabled).toBe(true);
      expect(edit?.title).toMatch(/attachments/i);
    });

    it('disables Edit for a saved image-only user turn', () => {
      renderMessages([
        {
          id: 'u-image',
          role: 'user',
          eventId: 'evt-image',
          blocks: [{ type: 'image', name: 'only.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,bbb' }],
          timestamp: 1000,
        },
      ]);

      const edit = query('Edit message');
      expect(edit).not.toBeNull();
      expect(edit?.disabled).toBe(true);
    });

    it('disables Regenerate on the newest reply when the preceding user turn has images', () => {
      renderMessages([
        {
          id: 'u-image',
          role: 'user',
          eventId: 'evt-image',
          blocks: [{ type: 'image', name: 'only.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,ccc' }],
          timestamp: 1000,
        },
        {
          id: 'a-reply',
          role: 'assistant',
          eventId: 'evt-reply',
          blocks: [{ type: 'text', content: 'That is a cat.' }],
          timestamp: 1001,
        },
      ]);

      const regen = query('Regenerate response');
      expect(regen).not.toBeNull();
      expect(regen?.disabled).toBe(true);
      expect(regen?.title).toMatch(/attachments/i);
    });

    it('hides Edit, Delete, Fork, and Regenerate for turns not yet persisted (no event id, e.g. browser mode)', () => {
      renderMessages([
        {
          id: 'u-unsaved',
          role: 'user',
          blocks: [{ type: 'text', content: 'just typed' }],
          timestamp: 1000,
        },
        {
          id: 'a-unsaved',
          role: 'assistant',
          blocks: [{ type: 'text', content: 'a reply' }],
          timestamp: 1001,
        },
      ]);

      expect(query('Edit message')).toBeNull();
      expect(query('Delete this message and all following messages')).toBeNull();
      expect(query('Fork conversation from here')).toBeNull();
      expect(query('Regenerate response')).toBeNull();
      // Copy stays available regardless of persistence.
      expect(screen.getAllByRole('button', { name: 'Copy message' }).length).toBeGreaterThan(0);
    });

    it('enables Edit, Delete, and Fork for a saved text-only user turn', () => {
      renderMessages([
        {
          id: 'u-text',
          role: 'user',
          eventId: 'evt-text',
          blocks: [{ type: 'text', content: 'plain question' }],
          timestamp: 1000,
        },
      ]);

      const edit = query('Edit message');
      const del = query('Delete this message and all following messages');
      const fork = query('Fork conversation from here');
      expect(edit?.disabled).toBe(false);
      expect(del?.disabled).toBe(false);
      expect(fork?.disabled).toBe(false);
    });

    it('disables row mutations while the active mind is switching models', () => {
      render(
        <AppStateProvider
          testInitialState={{
            activeMindId: MONEYPENNY.mindId,
            minds: [Q, MONEYPENNY],
            conversationViewByMind: {
              [MONEYPENNY.mindId]: {
                status: 'ready',
                sessionId: 'session-1',
                streaming: false,
                modelSwitching: true,
              },
            },
            messagesByMind: {
              [MONEYPENNY.mindId]: [
                {
                  id: 'u-text',
                  role: 'user',
                  eventId: 'evt-text',
                  blocks: [{ type: 'text', content: 'plain question' }],
                  timestamp: 1000,
                },
                {
                  id: 'a-text',
                  role: 'assistant',
                  eventId: 'evt-answer',
                  blocks: [{ type: 'text', content: 'plain answer' }],
                  timestamp: 1001,
                },
              ],
            },
          }}
        >
          <MessageList />
        </AppStateProvider>,
      );

      const edit = screen.getByRole('button', { name: 'Edit message' }) as HTMLButtonElement;
      const deletes = screen.getAllByRole('button', { name: 'Delete this message and all following messages' }) as HTMLButtonElement[];
      const forks = screen.getAllByRole('button', { name: 'Fork conversation from here' }) as HTMLButtonElement[];
      const regenerate = screen.getByRole('button', { name: 'Regenerate response' }) as HTMLButtonElement;
      const copies = screen.getAllByRole('button', { name: 'Copy message' }) as HTMLButtonElement[];
      expect(edit.disabled).toBe(true);
      expect(deletes.every((button) => button.disabled)).toBe(true);
      expect(forks.every((button) => button.disabled)).toBe(true);
      expect(regenerate.disabled).toBe(true);
      expect(copies.some((button) => !button.disabled)).toBe(true);
    });

    it('loads the active fork returned by Fork from here', async () => {
      const api = installElectronAPI();
      (api.chat.forkConversation as ReturnType<typeof vi.fn>).mockResolvedValue({
        sessionId: 'fork-session',
        messages: [
          {
            id: 'fork-seed:source-session:u-text',
            role: 'user',
            forkSeed: true,
            blocks: [{ type: 'text', content: 'seed question' }],
            timestamp: 1000,
          },
          {
            id: 'fork-new-user',
            role: 'user',
            blocks: [{ type: 'text', content: 'new fork question' }],
            timestamp: 2000,
          },
        ],
        conversations: [{
          sessionId: 'fork-session',
          title: 'Fork of Source chat',
          createdAt: '2026-05-05T22:10:00.000Z',
          updatedAt: '2026-05-05T22:10:00.000Z',
          kind: 'chat',
          active: true,
          hasMessages: false,
          forkOf: {
            sourceSessionId: 'source-session',
            sourceEventId: 'evt-text',
            sourceMessageId: 'u-text',
            sourceTitle: 'Source chat',
            createdAt: '2026-05-05T22:10:00.000Z',
          },
        }],
      });
      render(
        <AppStateProvider
          testInitialState={{
            activeMindId: MONEYPENNY.mindId,
            minds: [Q, MONEYPENNY],
            activeConversationByMind: { [MONEYPENNY.mindId]: 'source-session' },
            messagesByMind: {
              [MONEYPENNY.mindId]: [{
                id: 'u-text',
                role: 'user',
                eventId: 'evt-text',
                blocks: [{ type: 'text', content: 'plain question' }],
                timestamp: 1000,
              }],
            },
          }}
        >
          <MessageList />
        </AppStateProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Fork conversation from here' }));

      await waitFor(() => {
        expect(api.chat.forkConversation).toHaveBeenCalledWith(MONEYPENNY.mindId, 'source-session', 'evt-text');
      });
      expect(await screen.findByText('seed question')).toBeTruthy();
      expect(screen.getByText('new fork question')).toBeTruthy();
      expect(screen.getByText('Prior context')).toBeTruthy();
    });

    it('renders fork seed work blocks as prior context instead of active work', () => {
      renderMessages([
        {
          id: 'fork-seed:source-session:a1',
          role: 'assistant',
          forkSeed: true,
          blocks: [
            { type: 'tool_call', toolCallId: 't1', toolName: 'search', status: 'running', output: 'historical partial output' },
            { type: 'permission', requestId: 'p1', kind: 'shell', summary: 'run tests', outcome: 'pending' },
          ],
          timestamp: 1000,
        },
      ]);

      expect(screen.getByText('Prior context')).toBeTruthy();
      expect(screen.queryByLabelText('running')).toBeNull();
      expect(screen.queryByLabelText('awaiting permission')).toBeNull();
    });

    it('warns that editing an earlier turn removes the turns after it', () => {
      renderMessages([
        {
          id: 'u-first',
          role: 'user',
          eventId: 'evt-u1',
          blocks: [{ type: 'text', content: 'first question' }],
          timestamp: 1000,
        },
        {
          id: 'a-first',
          role: 'assistant',
          eventId: 'evt-a1',
          blocks: [{ type: 'text', content: 'first answer' }],
          timestamp: 1001,
        },
        {
          id: 'u-second',
          role: 'user',
          eventId: 'evt-u2',
          blocks: [{ type: 'text', content: 'second question' }],
          timestamp: 1002,
        },
      ]);

      // Enter the editor for the first (earliest) user turn — two turns follow it.
      const edits = screen.getAllByRole('button', { name: 'Edit message' });
      fireEvent.click(edits[0]);

      expect(screen.getByText('Resubmitting removes the 2 turns after this one.')).toBeTruthy();
    });

    it('does not warn when editing the most recent user turn', () => {
      renderMessages([
        {
          id: 'u-only',
          role: 'user',
          eventId: 'evt-only',
          blocks: [{ type: 'text', content: 'only question' }],
          timestamp: 1000,
        },
      ]);

      fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
      expect(screen.queryByText(/Resubmitting removes/)).toBeNull();
    });
  });

  describe('retained version pager', () => {
    const regenLive: ChatMessage[] = [
      { id: 'u2', role: 'user', eventId: 'e1', blocks: [{ type: 'text', content: 'question' }], timestamp: 1000 },
      { id: 'a2', role: 'assistant', eventId: 'e2', blocks: [{ type: 'text', content: 'new answer' }], timestamp: 1001 },
    ];
    const regenGroup: MessageVariantGroup = {
      groupId: 'g1',
      anchorEventId: null,
      frozenVariants: [{
        variantId: 'v1',
        createdAt: '2024-01-01T00:00:00.000Z',
        messages: [
          { id: 'u1', role: 'user', eventId: 'e1s', blocks: [{ type: 'text', content: 'question' }], timestamp: 900 },
          { id: 'a1', role: 'assistant', eventId: 'e2s', blocks: [{ type: 'text', content: 'old answer' }], timestamp: 901 },
        ],
      }],
    };

    function renderWithVariants(selection: Record<string, number>) {
      return render(
        <AppStateProvider
          testInitialState={{
            activeMindId: MONEYPENNY.mindId,
            minds: [Q, MONEYPENNY],
            messagesByMind: { [MONEYPENNY.mindId]: regenLive },
            variantGroupsByMind: { [MONEYPENNY.mindId]: [regenGroup] },
            variantSelectionByMind: { [MONEYPENNY.mindId]: selection },
          }}
        >
          <MessageList />
        </AppStateProvider>,
      );
    }

    it('shows no pager for a single-version conversation', () => {
      renderMessages([
        { id: 'u2', role: 'user', eventId: 'e1', blocks: [{ type: 'text', content: 'question' }], timestamp: 1000 },
        { id: 'a2', role: 'assistant', eventId: 'e2', blocks: [{ type: 'text', content: 'answer' }], timestamp: 1001 },
      ]);
      expect(screen.queryByRole('group', { name: 'Message versions' })).toBeNull();
    });

    it('shows a version pager on the assistant reply and defaults to the active version', () => {
      renderWithVariants({});
      expect(screen.getByRole('group', { name: 'Message versions' })).toBeTruthy();
      expect(screen.getByText('2/2')).toBeTruthy();
      expect(screen.getByText('new answer')).toBeTruthy();
      expect(screen.queryByText('old answer')).toBeNull();
    });

    it('toggling to the previous version shows the retained snapshot and hides the live tail', () => {
      renderWithVariants({ g1: 0 });
      expect(screen.getByText('1/2')).toBeTruthy();
      expect(screen.getByText('old answer')).toBeTruthy();
      expect(screen.queryByText('new answer')).toBeNull();
    });

    it('clicking previous selects the retained version', () => {
      renderWithVariants({});
      fireEvent.click(screen.getByRole('button', { name: 'Previous version' }));
      expect(screen.getByText('1/2')).toBeTruthy();
      expect(screen.getByText('old answer')).toBeTruthy();
    });

    it('suppresses mutating actions while a retained version is viewed', () => {
      renderWithVariants({ g1: 0 });
      expect(screen.queryByRole('button', { name: 'Edit message' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Regenerate response' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Fork conversation from here' })).toBeNull();
    });
  });
});
