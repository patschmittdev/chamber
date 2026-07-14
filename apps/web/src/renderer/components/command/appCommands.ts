import type { Dispatch } from 'react';
import {
  Activity,
  Archive,
  ArchiveRestore,
  Blocks,
  Bot,
  Braces,
  Brain,
  Eraser,
  FileText,
  Keyboard,
  Layout,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RadioTower,
  RefreshCw,
  Settings,
  Settings2,
  SunMoon,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ConversationSummary, LensViewManifest, MindContext } from '@chamber/shared/types';
import type { AppFeatureFlags } from '@chamber/shared/feature-flags';
import type { ElectronAPI } from '@chamber/shared/electron-types';
import type { AppAction, LensView } from '../../lib/store';
import { getVisibleLensViews } from '../../lib/lensVisibility';
import { Logger } from '../../lib/logger';
import { CommandRegistry } from '../../lib/commands';
import type { Command } from '../../lib/commands';

const log = Logger.create('CommandPalette');

const GROUP_VIEWS = 'Views';
const GROUP_CREATE = 'Create';
const GROUP_AGENTS = 'Agents';
const GROUP_CONVERSATION = 'Conversation';
const GROUP_GENERAL = 'General';

/** Always-present views that exist on master, rendered first in the Views group. */
const STATIC_VIEWS: readonly { id: LensView; label: string; icon: LucideIcon }[] = [
  { id: 'chat', label: 'Open Chat', icon: MessageSquare },
  { id: 'chatroom', label: 'Open Chatroom', icon: Users },
  { id: 'activity', label: 'Open Operator Activity', icon: Activity },
  { id: 'extensions', label: 'Open Extensions', icon: Blocks },
  { id: 'settings', label: 'Open Settings', icon: Settings },
];

/**
 * Mutable in-flight flag guarding against duplicate conversation creation. Shaped
 * like a React ref so the component can pass `useRef(false)` straight through.
 */
export interface CreationGuard {
  current: boolean;
}

/**
 * A single text value the palette collects through a hosted dialog before running
 * a command that needs input (rename, set system prompt). Keeps commands declarative:
 * the command asks the surface to prompt, and the surface owns the dialog lifecycle.
 */
export interface CommandPromptRequest {
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  placeholder?: string;
  /** Render a multi-line textarea instead of a single-line input. Defaults to false. */
  multiline?: boolean;
  submitLabel?: string;
  /** Called with the trimmed value when the user confirms. */
  onSubmit: (value: string) => void;
}

/** Surface actions the registry can drive, owned by the command surface component. */
export interface CommandSurfaceActions {
  toggleCommandPalette: () => void;
  toggleKeyboardShortcuts: () => void;
  /** Open a hosted text-input dialog, then hand the confirmed value back to the command. */
  promptText: (request: CommandPromptRequest) => void;
}

/** Live state plus injected effects the commands act on. Kept injectable for testing. */
export interface CommandContext {
  minds: MindContext[];
  discoveredViews: LensViewManifest[];
  disabledLensViewKeys: string[];
  featureFlags: AppFeatureFlags;
  activeMindId: string | null;
  activeView: LensView;
  /** The conversation the palette's conversation-scoped commands act on, or null. */
  activeConversation: ConversationSummary | null;
  /** True while the active mind is streaming or switching models; blocks conversation resets. */
  isActiveMindBusy: boolean;
  /** True when the most recent turn can be regenerated (persisted, no attachments). */
  canRegenerate: boolean;
  /** Shared in-flight flag so rapid repeat selections cannot spawn two sessions. */
  creationGuard: CreationGuard;
  dispatch: Dispatch<AppAction>;
  electronAPI: ElectronAPI;
  /** Re-runs the most recent user turn. Reuses the chat streaming action. */
  regenerate: () => void;
  /** Flips the light/dark theme. Reuses the appearance store action. */
  toggleTheme: () => void;
  ui: CommandSurfaceActions;
}

function switchToMind(
  mind: MindContext,
  dispatch: Dispatch<AppAction>,
  electronAPI: ElectronAPI,
  activeView: LensView,
): void {
  // Mirror MindSidebar.handleSwitchMind: focus a popout window if the mind is
  // windowed, otherwise switch the active mind in the main window.
  if (mind.windowed) {
    void electronAPI.mind.openWindow(mind.mindId);
    return;
  }
  void electronAPI.mind.setActive(mind.mindId);
  dispatch({ type: 'SET_ACTIVE_MIND', payload: mind.mindId });
  if (activeView !== 'extensions') {
    dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
  }
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

  // The A2A relay route only exists when the switchboard relay flag is enabled, so
  // it is registered conditionally to match ActivityBar's own visibility gate.
  if (context.featureFlags.switchboardRelay) {
    commands.push({
      id: 'view:a2a-relay',
      title: 'Open A2A relay',
      group: GROUP_VIEWS,
      icon: RadioTower,
      keywords: ['a2a', 'relay', 'switchboard', 'agent to agent'],
      run: () => context.dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'a2a-relay' }),
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
    run: () => switchToMind(mind, context.dispatch, context.electronAPI, context.activeView),
  }));

  commands.push({
    id: 'action:add-agent',
    title: 'Add agent',
    group: GROUP_AGENTS,
    icon: Plus,
    keywords: ['new agent', 'create mind'],
    run: () => context.dispatch({ type: 'SHOW_LANDING' }),
  });

  // Working memory lives in the agents settings section; the palette deep-links to
  // it. Read-only, so it stays available whenever a mind is active (even mid-stream).
  if (context.activeMindId) {
    const mindId = context.activeMindId;
    commands.push({
      id: 'action:view-working-memory',
      title: 'View working memory',
      group: GROUP_AGENTS,
      icon: Brain,
      keybinding: { mod: true, shift: true, key: 'm' },
      keywords: ['memory', 'working memory', 'notes', 'rules', 'log'],
      run: () => {
        context.dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'settings' });
        context.dispatch({ type: 'SET_PENDING_SETTINGS_INTENT', payload: { section: 'agents', mindId } });
      },
    });
  }

  return commands;
}

/**
 * Runs a conversation-history mutation that returns the refreshed list, then pushes
 * it into the store. Centralizes the electron-call + dispatch + error-log shape the
 * pin/archive/rename/system-prompt commands all share (mirrors ConversationHistoryPanel).
 */
function applyHistoryMutation(
  context: CommandContext,
  mindId: string,
  mutate: () => Promise<ConversationSummary[]>,
  errorMessage: string,
): void {
  void mutate()
    .then((conversations) => {
      context.dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId, conversations } });
    })
    .catch((error) => {
      log.error(errorMessage, error);
    });
}

/**
 * Conversation-scoped commands that act on a specific session: pin/archive toggles,
 * rename, export, and per-conversation system-prompt override. Titles and toggle
 * targets reflect the conversation's current state so a single command flips it.
 */
function activeConversationCommands(
  context: CommandContext,
  mindId: string,
  conversation: ConversationSummary,
): Command[] {
  const { sessionId } = conversation;
  const isPinned = conversation.isPinned === true;
  const isArchived = conversation.isArchived === true;
  const override = typeof conversation.systemMessage === 'string' ? conversation.systemMessage : '';

  const commands: Command[] = [
    {
      id: 'action:toggle-pin-conversation',
      title: isPinned ? 'Unpin conversation' : 'Pin conversation',
      group: GROUP_CONVERSATION,
      icon: isPinned ? PinOff : Pin,
      keywords: ['pin', 'unpin', 'favorite'],
      run: () =>
        applyHistoryMutation(
          context,
          mindId,
          () => context.electronAPI.conversationHistory.setPinned(mindId, sessionId, !isPinned),
          'Failed to update conversation pin state:',
        ),
    },
    {
      id: 'action:toggle-archive-conversation',
      title: isArchived ? 'Unarchive conversation' : 'Archive conversation',
      group: GROUP_CONVERSATION,
      icon: isArchived ? ArchiveRestore : Archive,
      keywords: ['archive', 'unarchive', 'hide'],
      run: () =>
        applyHistoryMutation(
          context,
          mindId,
          () => context.electronAPI.conversationHistory.setArchived(mindId, sessionId, !isArchived),
          'Failed to update conversation archive state:',
        ),
    },
    {
      id: 'action:rename-conversation',
      title: 'Rename conversation',
      group: GROUP_CONVERSATION,
      icon: Pencil,
      keywords: ['rename', 'title'],
      run: () =>
        context.ui.promptText({
          title: 'Rename conversation',
          label: 'Conversation title',
          initialValue: conversation.title,
          submitLabel: 'Rename',
          onSubmit: (value) => {
            if (!value) return;
            applyHistoryMutation(
              context,
              mindId,
              () => context.electronAPI.conversationHistory.rename(mindId, sessionId, value),
              'Failed to rename conversation:',
            );
          },
        }),
    },
    {
      id: 'action:export-conversation-markdown',
      title: 'Export conversation as Markdown',
      group: GROUP_CONVERSATION,
      icon: FileText,
      keywords: ['export', 'markdown', 'save', 'download'],
      run: () => {
        void context.electronAPI.conversationHistory
          .export(mindId, sessionId, 'markdown')
          .catch((error) => log.error('Failed to export conversation:', error));
      },
    },
    {
      id: 'action:export-conversation-json',
      title: 'Export conversation as JSON',
      group: GROUP_CONVERSATION,
      icon: Braces,
      keywords: ['export', 'json', 'save', 'download'],
      run: () => {
        void context.electronAPI.conversationHistory
          .export(mindId, sessionId, 'json')
          .catch((error) => log.error('Failed to export conversation:', error));
      },
    },
    {
      id: 'action:set-conversation-system-prompt',
      title: 'Set conversation system prompt',
      group: GROUP_CONVERSATION,
      icon: Settings2,
      keywords: ['system prompt', 'instructions', 'persona', 'override'],
      run: () =>
        context.ui.promptText({
          title: 'Conversation system prompt',
          description: 'Overrides the mind default for this conversation only.',
          label: 'System prompt',
          initialValue: override,
          multiline: true,
          submitLabel: 'Save',
          onSubmit: (value) =>
            applyHistoryMutation(
              context,
              mindId,
              () => context.electronAPI.conversationHistory.setSystemMessage(mindId, sessionId, value),
              'Failed to set conversation system prompt:',
            ),
        }),
    },
  ];

  // Clearing only makes sense when a non-empty override is present to remove.
  if (override.length > 0) {
    commands.push({
      id: 'action:clear-conversation-system-prompt',
      title: 'Clear conversation system prompt',
      group: GROUP_CONVERSATION,
      icon: Eraser,
      keywords: ['clear', 'reset', 'system prompt', 'default'],
      run: () =>
        applyHistoryMutation(
          context,
          mindId,
          () => context.electronAPI.conversationHistory.setSystemMessage(mindId, sessionId, ''),
          'Failed to clear conversation system prompt:',
        ),
    });
  }

  return commands;
}

/**
 * Conversation actions, all withheld while the active mind is busy or absent so the
 * palette cannot bypass the guards the history panel and chat surface enforce. The
 * conversation-scoped subset additionally requires a resolved active conversation.
 */
function conversationCommands(context: CommandContext): Command[] {
  const { activeMindId, isActiveMindBusy, activeConversation, canRegenerate } = context;
  if (!activeMindId || isActiveMindBusy) return [];

  const commands: Command[] = [
    {
      id: 'action:new-conversation',
      title: 'New conversation',
      group: GROUP_CONVERSATION,
      icon: MessageSquarePlus,
      keybinding: { mod: true, shift: true, key: 'o' },
      keywords: ['reset chat', 'start over', 'clear'],
      run: () => {
        void startNewConversation(activeMindId, context.dispatch, context.electronAPI, context.creationGuard);
      },
    },
  ];

  if (canRegenerate) {
    commands.push({
      id: 'action:regenerate',
      title: 'Regenerate last response',
      group: GROUP_CONVERSATION,
      icon: RefreshCw,
      keywords: ['regenerate', 'retry', 'rerun', 'redo'],
      run: () => context.regenerate(),
    });
  }

  if (activeConversation) {
    commands.push(...activeConversationCommands(context, activeMindId, activeConversation));
  }

  return commands;
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
      group: GROUP_CREATE,
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

/**
 * Prompt-library entry: open the Extensions Prompts tab and request the create
 * dialog through the one-shot extensions intent. Available without an active
 * mind because the prompt library is user-scoped rather than per-mind.
 */
function promptsCommands(context: CommandContext): Command[] {
  return [
    {
      id: 'action:new-prompt',
      title: 'New prompt',
      group: GROUP_CREATE,
      icon: Plus,
      keywords: ['create prompt', 'prompt', 'prompt library'],
      run: () => {
        context.dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'extensions' });
        context.dispatch({
          type: 'SET_PENDING_EXTENSIONS_INTENT',
          payload: { tab: 'prompts', action: 'create-prompt' },
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
    {
      id: 'command:toggle-theme',
      title: 'Toggle theme',
      group: GROUP_GENERAL,
      icon: SunMoon,
      keybinding: { mod: true, shift: true, key: 'l' },
      keywords: ['theme', 'dark mode', 'light mode', 'appearance'],
      run: () => context.toggleTheme(),
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
appCommandRegistry.register(promptsCommands);
appCommandRegistry.register(generalCommands);

/**
 * Build the command list from live app state by delegating to the shared registry,
 * so the palette and the global key handler consume one source of truth.
 */
export function buildCommandItems(context: CommandContext): Command[] {
  return appCommandRegistry.build(context);
}
