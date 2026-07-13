import type { Dispatch } from 'react';
import {
  Activity,
  Bot,
  Keyboard,
  Layout,
  MessageSquare,
  MessageSquarePlus,
  Plus,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { LensViewManifest, MindContext } from '@chamber/shared/types';
import type { ElectronAPI } from '@chamber/shared/electron-types';
import type { AppAction, LensView } from '../../lib/store';
import { getVisibleLensViews } from '../../lib/lensVisibility';
import { Logger } from '../../lib/logger';
import { CommandRegistry } from '../../lib/commands';
import type { Command } from '../../lib/commands';

const log = Logger.create('CommandPalette');

const GROUP_VIEWS = 'Views';
const GROUP_AGENTS = 'Agents';
const GROUP_CONVERSATION = 'Conversation';
const GROUP_GENERAL = 'General';

/** Always-present views that exist on master, rendered first in the Views group. */
const STATIC_VIEWS: readonly { id: LensView; label: string; icon: LucideIcon }[] = [
  { id: 'chat', label: 'Open Chat', icon: MessageSquare },
  { id: 'chatroom', label: 'Open Chatroom', icon: Users },
  { id: 'activity', label: 'Open Operator Activity', icon: Activity },
  { id: 'settings', label: 'Open Settings', icon: Settings },
];

/**
 * Mutable in-flight flag guarding against duplicate conversation creation. Shaped
 * like a React ref so the component can pass `useRef(false)` straight through.
 */
export interface CreationGuard {
  current: boolean;
}

/** Surface actions the registry can drive, owned by the command surface component. */
export interface CommandSurfaceActions {
  toggleCommandPalette: () => void;
  toggleKeyboardShortcuts: () => void;
}

/** Live state plus injected effects the commands act on. Kept injectable for testing. */
export interface CommandContext {
  minds: MindContext[];
  discoveredViews: LensViewManifest[];
  disabledLensViewKeys: string[];
  activeMindId: string | null;
  /** True while the active mind is streaming or switching models; blocks conversation resets. */
  isActiveMindBusy: boolean;
  /** Shared in-flight flag so rapid repeat selections cannot spawn two sessions. */
  creationGuard: CreationGuard;
  dispatch: Dispatch<AppAction>;
  electronAPI: ElectronAPI;
  ui: CommandSurfaceActions;
}

function switchToMind(mind: MindContext, dispatch: Dispatch<AppAction>, electronAPI: ElectronAPI): void {
  // Mirror MindSidebar.handleSwitchMind: focus a popout window if the mind is
  // windowed, otherwise switch the active mind in the main window.
  if (mind.windowed) {
    void electronAPI.mind.openWindow(mind.mindId);
    return;
  }
  void electronAPI.mind.setActive(mind.mindId);
  dispatch({ type: 'SET_ACTIVE_MIND', payload: mind.mindId });
  dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
}

async function startNewConversation(
  mindId: string,
  dispatch: Dispatch<AppAction>,
  electronAPI: ElectronAPI,
  guard: CreationGuard,
): Promise<void> {
  // Mirror ConversationHistoryPanel.startNewConversation: skip if a creation is
  // already in flight, reset the backend session, then hydrate the fresh session.
  if (guard.current) return;
  guard.current = true;
  try {
    const result = await electronAPI.chat.newConversation(mindId);
    await electronAPI.chatroom.clear();
    dispatch({
      type: 'RESUME_CONVERSATION',
      payload: {
        mindId,
        sessionId: result.sessionId,
        messages: result.messages,
        conversations: result.conversations,
      },
    });
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  } catch (error) {
    log.error('Failed to start new conversation from command palette:', error);
  } finally {
    guard.current = false;
  }
}

/** Built-in view routes plus any visible discovered Lens views. */
function viewCommands(context: CommandContext): Command[] {
  const commands: Command[] = [];

  for (const view of STATIC_VIEWS) {
    commands.push({
      id: `view:${view.id}`,
      title: view.label,
      group: GROUP_VIEWS,
      icon: view.icon,
      run: () => context.dispatch({ type: 'SET_ACTIVE_VIEW', payload: view.id }),
    });
  }

  for (const view of getVisibleLensViews(context.discoveredViews, context.disabledLensViewKeys, context.activeMindId)) {
    commands.push({
      // Namespace discovered views under `lens:` so a Lens declaring a reserved
      // id (chat/chatroom/settings) cannot collide with a STATIC_VIEWS command.
      id: `lens:${view.id}`,
      title: `Open ${view.name}`,
      group: GROUP_VIEWS,
      icon: Layout,
      keywords: [view.name, view.id],
      run: () => context.dispatch({ type: 'SET_ACTIVE_VIEW', payload: view.id }),
    });
  }

  return commands;
}

/** Switch-to-mind entries and the add-agent action. */
function agentCommands(context: CommandContext): Command[] {
  const commands: Command[] = context.minds.map((mind) => ({
    id: `mind:${mind.mindId}`,
    title: `Switch to ${mind.identity.name}`,
    group: GROUP_AGENTS,
    icon: Bot,
    keywords: [mind.identity.name, 'agent'],
    run: () => switchToMind(mind, context.dispatch, context.electronAPI),
  }));

  commands.push({
    id: 'action:add-agent',
    title: 'Add agent',
    group: GROUP_AGENTS,
    icon: Plus,
    keywords: ['new agent', 'create mind'],
    run: () => context.dispatch({ type: 'SHOW_LANDING' }),
  });

  return commands;
}

/** New-conversation reset, withheld while the active mind is busy or absent. */
function conversationCommands(context: CommandContext): Command[] {
  const { activeMindId, isActiveMindBusy } = context;
  // Omit conversation reset while the mind is streaming or switching models so the
  // palette cannot bypass the same guard the history panel enforces.
  if (!activeMindId || isActiveMindBusy) return [];

  return [
    {
      id: 'action:new-conversation',
      title: 'New conversation',
      group: GROUP_CONVERSATION,
      icon: MessageSquarePlus,
      keywords: ['reset chat', 'start over', 'clear'],
      run: () => {
        void startNewConversation(activeMindId, context.dispatch, context.electronAPI, context.creationGuard);
      },
    },
  ];
}

/**
 * Skills authoring entry: open the Extensions Skills tab and request the create
 * dialog through the one-shot extensions intent. Withheld without an active mind
 * because skills are per-mind and creation needs an owner.
 */
function skillsCommands(context: CommandContext): Command[] {
  if (!context.activeMindId) return [];

  return [
    {
      id: 'action:new-skill',
      title: 'New skill',
      group: GROUP_VIEWS,
      icon: Plus,
      keywords: ['create skill', 'skill', 'authoring'],
      run: () => {
        context.dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'extensions' });
        context.dispatch({
          type: 'SET_PENDING_EXTENSIONS_INTENT',
          payload: { tab: 'skills', action: 'create-skill' },
        });
      },
    },
  ];
}

/** Keyboard-driven surfaces: the palette toggle and the shortcuts help overlay. */
function generalCommands(context: CommandContext): Command[] {
  return [
    {
      id: 'command:toggle-palette',
      title: 'Command palette',
      group: GROUP_GENERAL,
      keybinding: { mod: true, key: 'k' },
      // Cmd/Ctrl+K has always toggled the palette even from inside an input.
      runWhileTyping: true,
      // Opening the palette from within itself would be redundant; keep it shortcut only.
      hideFromPalette: true,
      keywords: ['commands', 'search'],
      run: () => context.ui.toggleCommandPalette(),
    },
    {
      id: 'command:keyboard-shortcuts',
      title: 'Keyboard shortcuts',
      group: GROUP_GENERAL,
      icon: Keyboard,
      // On layouts where '?' needs AltGr the browser reports Ctrl+Alt, so the
      // shortcut will not fire there; the palette entry remains reachable.
      keybinding: { key: '?' },
      keywords: ['help', 'shortcuts', 'keys'],
      run: () => context.ui.toggleKeyboardShortcuts(),
    },
  ];
}

/**
 * Single source of truth for palette commands and their keybindings. Future
 * features register a provider here instead of hand-editing a parallel list.
 */
export const appCommandRegistry = new CommandRegistry<CommandContext>();
appCommandRegistry.register(viewCommands);
appCommandRegistry.register(agentCommands);
appCommandRegistry.register(conversationCommands);
appCommandRegistry.register(skillsCommands);
appCommandRegistry.register(generalCommands);

/**
 * Build the command list from live app state by delegating to the shared registry,
 * so the palette and the global key handler consume one source of truth.
 */
export function buildCommandItems(context: CommandContext): Command[] {
  return appCommandRegistry.build(context);
}
