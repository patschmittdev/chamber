import { useMemo } from 'react';
import type { Command } from '../../lib/commands';
import { groupCommands, keybindingTokens } from '../../lib/commands';
import { isMac } from '../../lib/platform';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
}

/**
 * Help overlay listing every registered command, grouped the same way the palette
 * groups its entries. Commands with a keybinding show their chord tokens; the rest
 * render a muted "Unassigned" hint so the full surface stays discoverable. Reachable
 * via the `?` shortcut and from the palette's "Keyboard shortcuts" command.
 */
export function KeyboardShortcutsDialog({ open, onOpenChange, commands }: KeyboardShortcutsDialogProps) {
  const groups = useMemo(() => groupCommands(commands), [commands]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Available commands and their keybindings.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {groups.map(({ group, items }) => (
            <section key={group} className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{group}</h3>
              <ul className="flex flex-col gap-1">
                {items.map((command) => {
                  const tokens = command.keybinding ? keybindingTokens(command.keybinding, isMac) : [];
                  return (
                    <li key={command.id} className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-foreground">{command.title}</span>
                      <span className="flex items-center gap-1">
                        {tokens.length > 0 ? (
                          tokens.map((token) => (
                            <kbd
                              key={token}
                              className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                            >
                              {token}
                            </kbd>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground/60">Unassigned</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
