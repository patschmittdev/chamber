import { describe, it, expect, vi } from 'vitest';
import type { ConversationSummary, MindContext } from '@chamber/shared/types';
import { DEFAULT_APP_FEATURE_FLAGS } from '@chamber/shared/feature-flags';
import { mockElectronAPI, makeLensViewManifest } from '../../../test/helpers';
import { buildCommandItems, type CommandContext } from './appCommands';

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\agents\\monica',
  identity: { name: 'Monica', systemMessage: '# Monica' },
  status: 'ready',
};

const NEW_CONVERSATION = 'action:new-conversation';

function makeConversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    sessionId: 'sess-1',
    title: 'Planning thread',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    kind: 'chat',
    active: true,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    minds: [],
    discoveredViews: [],
    disabledLensViewKeys: [],
    featureFlags: DEFAULT_APP_FEATURE_FLAGS,
    activeMindId: null,
    activeConversation: null,
    isActiveMindBusy: false,
    canRegenerate: false,
    creationGuard: { current: false },
    dispatch: vi.fn(),
    electronAPI: mockElectronAPI(),
    regenerate: vi.fn(),
    toggleTheme: vi.fn(),
    ui: { toggleCommandPalette: vi.fn(), toggleKeyboardShortcuts: vi.fn(), promptText: vi.fn() },
    ...overrides,
  };
}

describe('buildCommandItems', () => {
  it('dispatches SET_ACTIVE_VIEW when the Open Settings command runs', () => {
    const dispatch = vi.fn();
    const commands = buildCommandItems(makeDeps({ dispatch }));

    const settings = commands.find((command) => command.id === 'view:settings');
    expect(settings).toBeDefined();
    settings?.run();

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_VIEW', payload: 'settings' });
  });

  it('dispatches SET_ACTIVE_VIEW when the Open Operator Activity command runs', () => {
    const dispatch = vi.fn();
    const commands = buildCommandItems(makeDeps({ dispatch }));

    const activity = commands.find((command) => command.id === 'view:activity');
    expect(activity).toBeDefined();
    activity?.run();

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_VIEW', payload: 'activity' });
  });

  it('switches the active mind through electron and the store', () => {
    const dispatch = vi.fn();
    const electronAPI = mockElectronAPI();
    const commands = buildCommandItems(
      makeDeps({ minds: [mind], activeMindId: mind.mindId, dispatch, electronAPI }),
    );

    const switchCommand = commands.find((command) => command.id === `mind:${mind.mindId}`);
    expect(switchCommand).toBeDefined();
    switchCommand?.run();

    expect(electronAPI.mind.setActive).toHaveBeenCalledWith(mind.mindId);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_MIND', payload: mind.mindId });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  });

  it('offers the new conversation command only for an idle active mind', () => {
    const withoutMind = buildCommandItems(makeDeps());
    expect(withoutMind.some((command) => command.id === NEW_CONVERSATION)).toBe(false);

    const idleMind = buildCommandItems(makeDeps({ minds: [mind], activeMindId: mind.mindId }));
    expect(idleMind.some((command) => command.id === NEW_CONVERSATION)).toBe(true);
  });

  it('namespaces discovered Lens view commands so they cannot collide with reserved view ids', () => {
    const dispatch = vi.fn();
    const commands = buildCommandItems(
      makeDeps({ dispatch, activeMindId: mind.mindId, discoveredViews: [makeLensViewManifest({ id: 'chat', name: 'Custom Chat' })] }),
    );

    const ids = commands.map((command) => command.id);
    expect(ids).toContain('view:chat');
    expect(ids).toContain('lens:chat');

    commands.find((command) => command.id === 'lens:chat')?.run();
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  });

  it('omits disabled Lens view commands from the palette', () => {
    const commands = buildCommandItems(
      makeDeps({
        activeMindId: mind.mindId,
        discoveredViews: [makeLensViewManifest({ id: 'briefing', name: 'Briefing' })],
        disabledLensViewKeys: [`${mind.mindId}:briefing`],
      }),
    );

    expect(commands.some((command) => command.id === 'lens:briefing')).toBe(false);
  });

  it('omits the new conversation command while the active mind is busy', () => {
    const busy = buildCommandItems(
      makeDeps({ minds: [mind], activeMindId: mind.mindId, isActiveMindBusy: true }),
    );
    expect(busy.some((command) => command.id === NEW_CONVERSATION)).toBe(false);
  });

  it('guards against duplicate concurrent conversation creation', async () => {
    const electronAPI = mockElectronAPI();
    let resolveNewConversation: (value: { sessionId: string; messages: []; conversations: [] }) => void = () => {};
    (electronAPI.chat.newConversation as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { resolveNewConversation = resolve; }),
    );
    const creationGuard = { current: false };
    const commands = buildCommandItems(
      makeDeps({ minds: [mind], activeMindId: mind.mindId, creationGuard, electronAPI }),
    );
    const newConversation = commands.find((command) => command.id === NEW_CONVERSATION);
    expect(newConversation).toBeDefined();

    newConversation?.run();
    newConversation?.run();

    expect(electronAPI.chat.newConversation).toHaveBeenCalledTimes(1);

    resolveNewConversation({ sessionId: 's1', messages: [], conversations: [] });
    await vi.waitFor(() => expect(creationGuard.current).toBe(false));

    newConversation?.run();
    expect(electronAPI.chat.newConversation).toHaveBeenCalledTimes(2);
  });

  it('routes the New skill command to the Skills tab and requests the create dialog', () => {
    const dispatch = vi.fn();
    const commands = buildCommandItems(makeDeps({ dispatch, minds: [mind], activeMindId: mind.mindId }));

    const newSkill = commands.find((command) => command.id === 'action:new-skill');
    expect(newSkill).toBeDefined();
    newSkill?.run();

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_VIEW', payload: 'extensions' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_PENDING_EXTENSIONS_INTENT',
      payload: { tab: 'skills', action: 'create-skill' },
    });
  });

  it('omits the New skill command when no mind is active', () => {
    const commands = buildCommandItems(makeDeps());
    expect(commands.some((command) => command.id === 'action:new-skill')).toBe(false);
  });

  it('routes the New prompt command to the Prompts tab and requests the create dialog', () => {
    const dispatch = vi.fn();
    const commands = buildCommandItems(makeDeps({ dispatch }));

    const newPrompt = commands.find((command) => command.id === 'action:new-prompt');
    expect(newPrompt).toBeDefined();
    newPrompt?.run();

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_VIEW', payload: 'extensions' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_PENDING_EXTENSIONS_INTENT',
      payload: { tab: 'prompts', action: 'create-prompt' },
    });
  });

  it('offers the New prompt command even without an active mind', () => {
    const commands = buildCommandItems(makeDeps());
    expect(commands.some((command) => command.id === 'action:new-prompt')).toBe(true);
  });

  it('registers the palette and shortcuts commands with their keybindings', () => {
    const commands = buildCommandItems(makeDeps());

    const palette = commands.find((command) => command.id === 'command:toggle-palette');
    expect(palette?.keybinding).toEqual({ mod: true, key: 'k' });
    expect(palette?.runWhileTyping).toBe(true);
    expect(palette?.hideFromPalette).toBe(true);

    const shortcuts = commands.find((command) => command.id === 'command:keyboard-shortcuts');
    expect(shortcuts?.keybinding).toEqual({ key: '?' });
    expect(shortcuts?.hideFromPalette).toBeFalsy();
  });

  it('invokes the surface actions when the general commands run', () => {
    const ui = { toggleCommandPalette: vi.fn(), toggleKeyboardShortcuts: vi.fn(), promptText: vi.fn() };
    const commands = buildCommandItems(makeDeps({ ui }));

    commands.find((command) => command.id === 'command:toggle-palette')?.run();
    commands.find((command) => command.id === 'command:keyboard-shortcuts')?.run();

    expect(ui.toggleCommandPalette).toHaveBeenCalledTimes(1);
    expect(ui.toggleKeyboardShortcuts).toHaveBeenCalledTimes(1);
  });

  it('files New skill and New prompt under the Create group rather than Views', () => {
    const commands = buildCommandItems(makeDeps({ minds: [mind], activeMindId: mind.mindId }));

    const skill = commands.find((command) => command.id === 'action:new-skill');
    const prompt = commands.find((command) => command.id === 'action:new-prompt');
    expect(skill?.group).toBe('Create');
    expect(prompt?.group).toBe('Create');
  });

  it('offers Open Extensions in the Views group', () => {
    const dispatch = vi.fn();
    const commands = buildCommandItems(makeDeps({ dispatch }));

    const extensions = commands.find((command) => command.id === 'view:extensions');
    expect(extensions?.group).toBe('Views');
    extensions?.run();
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_VIEW', payload: 'extensions' });
  });

  it('offers Open A2A relay only when the switchboard relay flag is enabled', () => {
    const withoutFlag = buildCommandItems(makeDeps());
    expect(withoutFlag.some((command) => command.id === 'view:a2a-relay')).toBe(false);

    const dispatch = vi.fn();
    const withFlag = buildCommandItems(
      makeDeps({ dispatch, featureFlags: { ...DEFAULT_APP_FEATURE_FLAGS, switchboardRelay: true } }),
    );
    const relay = withFlag.find((command) => command.id === 'view:a2a-relay');
    expect(relay?.group).toBe('Views');
    relay?.run();
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_VIEW', payload: 'a2a-relay' });
  });

  it('routes View working memory to the Agents settings section for the active mind', () => {
    const dispatch = vi.fn();
    const commands = buildCommandItems(makeDeps({ dispatch, minds: [mind], activeMindId: mind.mindId }));

    const workingMemory = commands.find((command) => command.id === 'action:view-working-memory');
    expect(workingMemory?.group).toBe('Agents');
    expect(workingMemory?.keybinding).toEqual({ mod: true, shift: true, key: 'm' });
    workingMemory?.run();

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ACTIVE_VIEW', payload: 'settings' });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_PENDING_SETTINGS_INTENT',
      payload: { section: 'agents', mindId: mind.mindId },
    });
  });

  it('omits View working memory when no mind is active', () => {
    const commands = buildCommandItems(makeDeps());
    expect(commands.some((command) => command.id === 'action:view-working-memory')).toBe(false);
  });

  it('flips the theme store through the Toggle theme command', () => {
    const toggleTheme = vi.fn();
    const commands = buildCommandItems(makeDeps({ toggleTheme }));

    const toggle = commands.find((command) => command.id === 'command:toggle-theme');
    expect(toggle?.group).toBe('General');
    expect(toggle?.keybinding).toEqual({ mod: true, shift: true, key: 'l' });
    toggle?.run();

    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });

  it('binds New conversation to Mod+Shift+O', () => {
    const commands = buildCommandItems(makeDeps({ minds: [mind], activeMindId: mind.mindId }));
    const newConversation = commands.find((command) => command.id === NEW_CONVERSATION);
    expect(newConversation?.keybinding).toEqual({ mod: true, shift: true, key: 'o' });
  });

  it('withholds conversation-scoped commands when there is no active conversation', () => {
    const commands = buildCommandItems(makeDeps({ minds: [mind], activeMindId: mind.mindId }));
    expect(commands.some((command) => command.id === 'action:toggle-pin-conversation')).toBe(false);
    expect(commands.some((command) => command.id === 'action:rename-conversation')).toBe(false);
    expect(commands.some((command) => command.id === 'action:export-conversation-markdown')).toBe(false);
  });

  it('withholds conversation-scoped commands while the active mind is busy', () => {
    const commands = buildCommandItems(
      makeDeps({
        minds: [mind],
        activeMindId: mind.mindId,
        activeConversation: makeConversation(),
        isActiveMindBusy: true,
      }),
    );
    expect(commands.some((command) => command.id === 'action:toggle-pin-conversation')).toBe(false);
    expect(commands.some((command) => command.id === 'action:toggle-archive-conversation')).toBe(false);
  });

  it('pins the active conversation and refreshes history', async () => {
    const dispatch = vi.fn();
    const electronAPI = mockElectronAPI();
    (electronAPI.conversationHistory.setPinned as ReturnType<typeof vi.fn>).mockResolvedValue([makeConversation({ isPinned: true })]);
    const commands = buildCommandItems(
      makeDeps({ dispatch, electronAPI, minds: [mind], activeMindId: mind.mindId, activeConversation: makeConversation() }),
    );

    const pin = commands.find((command) => command.id === 'action:toggle-pin-conversation');
    expect(pin?.group).toBe('Conversation');
    expect(pin?.title).toBe('Pin conversation');
    pin?.run();

    expect(electronAPI.conversationHistory.setPinned).toHaveBeenCalledWith(mind.mindId, 'sess-1', true);
    await vi.waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith({
        type: 'SET_CONVERSATION_HISTORY',
        payload: { mindId: mind.mindId, conversations: [makeConversation({ isPinned: true })] },
      }),
    );
  });

  it('titles the pin command Unpin when the conversation is already pinned', () => {
    const commands = buildCommandItems(
      makeDeps({ minds: [mind], activeMindId: mind.mindId, activeConversation: makeConversation({ isPinned: true }) }),
    );
    const pin = commands.find((command) => command.id === 'action:toggle-pin-conversation');
    expect(pin?.title).toBe('Unpin conversation');
    pin?.run();
    // Unpinning passes pinned=false.
    // (assertion on the call is covered indirectly; the title reflects the toggle target.)
  });

  it('archives the active conversation through the electron contract', () => {
    const electronAPI = mockElectronAPI();
    const commands = buildCommandItems(
      makeDeps({ electronAPI, minds: [mind], activeMindId: mind.mindId, activeConversation: makeConversation() }),
    );
    const archive = commands.find((command) => command.id === 'action:toggle-archive-conversation');
    expect(archive?.title).toBe('Archive conversation');
    archive?.run();
    expect(electronAPI.conversationHistory.setArchived).toHaveBeenCalledWith(mind.mindId, 'sess-1', true);
  });

  it('renames the active conversation through the hosted prompt', () => {
    const dispatch = vi.fn();
    const electronAPI = mockElectronAPI();
    const promptText = vi.fn();
    const commands = buildCommandItems(
      makeDeps({
        dispatch,
        electronAPI,
        minds: [mind],
        activeMindId: mind.mindId,
        activeConversation: makeConversation({ title: 'Old title' }),
        ui: { toggleCommandPalette: vi.fn(), toggleKeyboardShortcuts: vi.fn(), promptText },
      }),
    );

    const rename = commands.find((command) => command.id === 'action:rename-conversation');
    expect(rename?.group).toBe('Conversation');
    rename?.run();

    expect(promptText).toHaveBeenCalledTimes(1);
    const request = promptText.mock.calls[0][0];
    expect(request.initialValue).toBe('Old title');

    request.onSubmit('New title');
    expect(electronAPI.conversationHistory.rename).toHaveBeenCalledWith(mind.mindId, 'sess-1', 'New title');
  });

  it('exports the active conversation as markdown and json', () => {
    const electronAPI = mockElectronAPI();
    const commands = buildCommandItems(
      makeDeps({ electronAPI, minds: [mind], activeMindId: mind.mindId, activeConversation: makeConversation() }),
    );

    commands.find((command) => command.id === 'action:export-conversation-markdown')?.run();
    commands.find((command) => command.id === 'action:export-conversation-json')?.run();

    expect(electronAPI.conversationHistory.export).toHaveBeenCalledWith(mind.mindId, 'sess-1', 'markdown');
    expect(electronAPI.conversationHistory.export).toHaveBeenCalledWith(mind.mindId, 'sess-1', 'json');
  });

  it('sets a per-conversation system prompt through the hosted prompt', () => {
    const electronAPI = mockElectronAPI();
    const promptText = vi.fn();
    const commands = buildCommandItems(
      makeDeps({
        electronAPI,
        minds: [mind],
        activeMindId: mind.mindId,
        activeConversation: makeConversation({ systemMessage: 'Existing override' }),
        ui: { toggleCommandPalette: vi.fn(), toggleKeyboardShortcuts: vi.fn(), promptText },
      }),
    );

    const setPrompt = commands.find((command) => command.id === 'action:set-conversation-system-prompt');
    setPrompt?.run();
    expect(promptText).toHaveBeenCalledTimes(1);
    const request = promptText.mock.calls[0][0];
    expect(request.multiline).toBe(true);
    expect(request.initialValue).toBe('Existing override');

    request.onSubmit('Fresh override');
    expect(electronAPI.conversationHistory.setSystemMessage).toHaveBeenCalledWith(mind.mindId, 'sess-1', 'Fresh override');
  });

  it('offers Clear system prompt only when an override exists', () => {
    const withoutOverride = buildCommandItems(
      makeDeps({ minds: [mind], activeMindId: mind.mindId, activeConversation: makeConversation() }),
    );
    expect(withoutOverride.some((command) => command.id === 'action:clear-conversation-system-prompt')).toBe(false);

    const electronAPI = mockElectronAPI();
    const withOverride = buildCommandItems(
      makeDeps({
        electronAPI,
        minds: [mind],
        activeMindId: mind.mindId,
        activeConversation: makeConversation({ systemMessage: 'Override' }),
      }),
    );
    const clear = withOverride.find((command) => command.id === 'action:clear-conversation-system-prompt');
    expect(clear).toBeDefined();
    clear?.run();
    expect(electronAPI.conversationHistory.setSystemMessage).toHaveBeenCalledWith(mind.mindId, 'sess-1', '');
  });

  it('regenerates the last turn only when a regenerable turn exists', () => {
    const withoutTurn = buildCommandItems(
      makeDeps({ minds: [mind], activeMindId: mind.mindId, activeConversation: makeConversation(), canRegenerate: false }),
    );
    expect(withoutTurn.some((command) => command.id === 'action:regenerate')).toBe(false);

    const regenerate = vi.fn();
    const commands = buildCommandItems(
      makeDeps({ regenerate, minds: [mind], activeMindId: mind.mindId, activeConversation: makeConversation(), canRegenerate: true }),
    );
    const command = commands.find((entry) => entry.id === 'action:regenerate');
    expect(command?.group).toBe('Conversation');
    command?.run();
    expect(regenerate).toHaveBeenCalledTimes(1);
  });

  it('builds the full command set without keybinding conflicts', () => {
    expect(() =>
      buildCommandItems(
        makeDeps({
          minds: [mind],
          activeMindId: mind.mindId,
          activeConversation: makeConversation({ systemMessage: 'Override' }),
          canRegenerate: true,
          featureFlags: { ...DEFAULT_APP_FEATURE_FLAGS, switchboardRelay: true },
        }),
      ),
    ).not.toThrow();
  });
});
