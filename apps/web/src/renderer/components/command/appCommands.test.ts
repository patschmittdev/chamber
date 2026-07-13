import { describe, it, expect, vi } from 'vitest';
import type { MindContext } from '@chamber/shared/types';
import { mockElectronAPI, makeLensViewManifest } from '../../../test/helpers';
import { buildCommandItems, type CommandContext } from './appCommands';

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\agents\\monica',
  identity: { name: 'Monica', systemMessage: '# Monica' },
  status: 'ready',
};

const NEW_CONVERSATION = 'action:new-conversation';

function makeDeps(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    minds: [],
    discoveredViews: [],
    disabledLensViewKeys: [],
    activeMindId: null,
    isActiveMindBusy: false,
    creationGuard: { current: false },
    dispatch: vi.fn(),
    electronAPI: mockElectronAPI(),
    ui: { toggleCommandPalette: vi.fn(), toggleKeyboardShortcuts: vi.fn() },
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
    const ui = { toggleCommandPalette: vi.fn(), toggleKeyboardShortcuts: vi.fn() };
    const commands = buildCommandItems(makeDeps({ ui }));

    commands.find((command) => command.id === 'command:toggle-palette')?.run();
    commands.find((command) => command.id === 'command:keyboard-shortcuts')?.run();

    expect(ui.toggleCommandPalette).toHaveBeenCalledTimes(1);
    expect(ui.toggleKeyboardShortcuts).toHaveBeenCalledTimes(1);
  });
});
