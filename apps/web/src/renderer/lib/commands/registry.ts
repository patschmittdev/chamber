import type { Command, CommandGroupView } from './types';
import { keybindingConflictKey } from './keybinding';

/** A source of commands built from the app-supplied context. */
export type CommandProvider<C> = (context: C) => Command[];

/** Two or more commands claiming the same chord. */
export interface KeybindingConflict {
  chordId: string;
  commandIds: string[];
}

/**
 * Find commands that share a chord. Shift is treated as non-distinguishing (see
 * keybindingConflictKey), so a shift variant collides with its base chord.
 * Commands without a keybinding are ignored.
 */
export function findKeybindingConflicts(commands: Command[]): KeybindingConflict[] {
  const byChord = new Map<string, string[]>();
  for (const command of commands) {
    if (!command.keybinding) continue;
    const chordId = keybindingConflictKey(command.keybinding);
    const ids = byChord.get(chordId);
    if (ids) {
      ids.push(command.id);
    } else {
      byChord.set(chordId, [command.id]);
    }
  }

  const conflicts: KeybindingConflict[] = [];
  for (const [chordId, commandIds] of byChord) {
    if (commandIds.length > 1) conflicts.push({ chordId, commandIds });
  }
  return conflicts;
}

/** Group commands by their `group`, preserving first-seen group order. */
export function groupCommands(commands: Command[]): CommandGroupView[] {
  const groups: CommandGroupView[] = [];
  const byGroup = new Map<string, CommandGroupView>();
  for (const command of commands) {
    let view = byGroup.get(command.group);
    if (!view) {
      view = { group: command.group, items: [] };
      byGroup.set(command.group, view);
      groups.push(view);
    }
    view.items.push(command);
  }
  return groups;
}

/**
 * Single source of truth for commands and their keybindings. Generic over an
 * app-supplied context so the core stays feature-agnostic: features register a
 * provider instead of hand-editing a shared list. `build` validates that no two
 * commands claim the same chord, surfacing a dev-time error the moment a collision
 * is introduced.
 */
export class CommandRegistry<C> {
  private readonly providers: CommandProvider<C>[] = [];

  register(provider: CommandProvider<C>): void {
    this.providers.push(provider);
  }

  build(context: C): Command[] {
    const commands = this.providers.flatMap((provider) => provider(context));
    const conflicts = findKeybindingConflicts(commands);
    if (conflicts.length > 0) {
      const summary = conflicts
        .map((conflict) => `${conflict.chordId} claimed by ${conflict.commandIds.join(', ')}`)
        .join('; ');
      throw new Error(`Conflicting command keybindings: ${summary}`);
    }
    return commands;
  }
}
