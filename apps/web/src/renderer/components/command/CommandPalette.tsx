import { useCallback, useMemo, useRef, useState } from 'react';
import type { Command } from '../../lib/commands';
import { groupCommands } from '../../lib/commands';
import { useAppDispatch, useAppState } from '../../lib/store';
import { useCommandShortcuts } from '../../hooks/useCommandShortcuts';
import { useChatStreaming } from '../../hooks/useChatStreaming';
import { appearanceStore } from '../../lib/appearanceStore';
import { hasAttachmentBlocks } from '../chat/messageContent';
import { buildCommandItems, type CommandPromptRequest, type CommandSurfaceActions } from './appCommands';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import { CommandPromptDialog } from './CommandPromptDialog';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';

const INPUT_PLACEHOLDER = 'Type a command or search...';

/**
 * Command surface mounted once by AppShell. It builds the command list from the
 * shared registry, drives global keybindings through `useCommandShortcuts`, and
 * renders both the searchable palette (Cmd/Ctrl+K) and the keyboard shortcuts help
 * overlay (?). Command definitions and their keybindings live in `appCommands`.
 */
export function CommandPalette() {
  const {
    minds,
    discoveredViews,
    disabledLensViewKeys,
    activeMindId,
    streamingByMind,
    conversationViewByMind,
    conversationHistoryByMind,
    activeConversationByMind,
    messagesByMind,
    featureFlags,
  } = useAppState();
  const dispatch = useAppDispatch();
  const { regenerate } = useChatStreaming();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [promptRequest, setPromptRequest] = useState<CommandPromptRequest | null>(null);
  const creationGuard = useRef(false);

  // Mirror ConversationHistoryPanel: streaming or model-switching means the active
  // mind is busy and conversation resets must be withheld.
  const activeConversationView = activeMindId ? conversationViewByMind[activeMindId] : undefined;
  const isActiveMindBusy = activeMindId
    ? Boolean(streamingByMind[activeMindId] || activeConversationView?.streaming || activeConversationView?.modelSwitching)
    : false;

  // Resolve the conversation the palette's conversation-scoped commands act on:
  // prefer the explicitly active session, falling back to the one flagged active.
  const activeConversation = useMemo(() => {
    if (!activeMindId) return null;
    const history = conversationHistoryByMind[activeMindId] ?? [];
    const activeSessionId = activeConversationByMind[activeMindId];
    return (
      history.find((conversation) => conversation.sessionId === activeSessionId) ??
      history.find((conversation) => conversation.active) ??
      null
    );
  }, [activeMindId, conversationHistoryByMind, activeConversationByMind]);

  // A turn is regenerable only when the last user message is persisted (has an
  // event id) and carries no attachments, matching useChatStreaming.regenerate's
  // own guard so the palette never offers an action the handler would reject.
  const canRegenerate = useMemo(() => {
    if (!activeMindId || isActiveMindBusy) return false;
    const messages = messagesByMind[activeMindId] ?? [];
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    return Boolean(lastUser && lastUser.eventId && !hasAttachmentBlocks(lastUser));
  }, [activeMindId, isActiveMindBusy, messagesByMind]);

  const ui = useMemo<CommandSurfaceActions>(
    () => ({
      // Keep the two overlays mutually exclusive so opening one dismisses the
      // other, otherwise both Radix dialogs stack and one is orphaned on close.
      toggleCommandPalette: () => {
        setShortcutsOpen(false);
        setPaletteOpen((previous) => !previous);
      },
      toggleKeyboardShortcuts: () => {
        setPaletteOpen(false);
        setShortcutsOpen((previous) => !previous);
      },
      // Hand text-collecting commands a hosted dialog; dismiss the palette first so
      // the prompt is the only surface in focus.
      promptText: (request) => {
        setPaletteOpen(false);
        setShortcutsOpen(false);
        setPromptRequest(request);
      },
    }),
    [],
  );

  const commands = useMemo(
    () => buildCommandItems({
      minds,
      discoveredViews,
      disabledLensViewKeys,
      featureFlags,
      activeMindId,
      activeConversation,
      isActiveMindBusy,
      canRegenerate,
      creationGuard,
      dispatch,
      electronAPI: window.electronAPI,
      regenerate: () => { void regenerate(); },
      toggleTheme: appearanceStore.toggleTheme,
      ui,
    }),
    [minds, discoveredViews, disabledLensViewKeys, featureFlags, activeMindId, activeConversation, isActiveMindBusy, canRegenerate, dispatch, regenerate, ui],
  );

  useCommandShortcuts(commands);

  const paletteGroups = useMemo(
    () => groupCommands(commands.filter((command) => !command.hideFromPalette)),
    [commands],
  );

  const runCommand = useCallback((command: Command) => {
    command.run();
    setPaletteOpen(false);
  }, []);

  return (
    <>
      <CommandDialog
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        title="Command palette"
        description="Search for a command to run"
      >
        <CommandInput aria-label="Search commands" placeholder={INPUT_PLACEHOLDER} />
        <CommandList className="max-h-[400px]">
          <CommandEmpty>No results found.</CommandEmpty>
          {paletteGroups.map(({ group, items }) => (
            <CommandGroup key={group} heading={group}>
              {items.map((command) => {
                const Icon = command.icon;
                return (
                  <CommandItem
                    key={command.id}
                    value={`${command.id} ${command.title} ${command.keywords?.join(' ') ?? ''}`}
                    onSelect={() => runCommand(command)}
                  >
                    {Icon ? <Icon size={16} className="text-muted-foreground" aria-hidden /> : null}
                    <span>{command.title}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} commands={commands} />
      <CommandPromptDialog request={promptRequest} onClose={() => setPromptRequest(null)} />
    </>
  );
}
