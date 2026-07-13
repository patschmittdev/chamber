import { useCallback, useMemo, useRef, useState } from 'react';
import type { Command } from '../../lib/commands';
import { groupCommands } from '../../lib/commands';
import { useAppDispatch, useAppState } from '../../lib/store';
import { useCommandShortcuts } from '../../hooks/useCommandShortcuts';
import { buildCommandItems, type CommandSurfaceActions } from './appCommands';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
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
  const { minds, discoveredViews, disabledLensViewKeys, activeMindId, streamingByMind, conversationViewByMind } = useAppState();
  const dispatch = useAppDispatch();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const creationGuard = useRef(false);

  // Mirror ConversationHistoryPanel: streaming or model-switching means the active
  // mind is busy and conversation resets must be withheld.
  const activeConversationView = activeMindId ? conversationViewByMind[activeMindId] : undefined;
  const isActiveMindBusy = activeMindId
    ? Boolean(streamingByMind[activeMindId] || activeConversationView?.streaming || activeConversationView?.modelSwitching)
    : false;

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
    }),
    [],
  );

  const commands = useMemo(
    () => buildCommandItems({
      minds,
      discoveredViews,
      disabledLensViewKeys,
      activeMindId,
      isActiveMindBusy,
      creationGuard,
      dispatch,
      electronAPI: window.electronAPI,
      ui,
    }),
    [minds, discoveredViews, disabledLensViewKeys, activeMindId, isActiveMindBusy, dispatch, ui],
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
    </>
  );
}
