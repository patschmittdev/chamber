import type { LucideIcon } from 'lucide-react';

/**
 * A keyboard chord: a single non-modifier key plus optional modifiers. `mod` is the
 * platform accelerator (Cmd on macOS, Ctrl elsewhere) and matches either metaKey or
 * ctrlKey, so one declaration works across platforms.
 */
export interface Keybinding {
  /** Compared case-insensitively against KeyboardEvent.key (for example 'k' or '?'). */
  key: string;
  /** Platform accelerator: Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/**
 * A single command surfaced by the registry. `run` is pre-bound to its side effects,
 * mirroring the palette's original per-command closures.
 */
export interface Command {
  id: string;
  title: string;
  group: string;
  run: () => void;
  keybinding?: Keybinding;
  icon?: LucideIcon;
  keywords?: string[];
  /** Fire the keybinding even while an input or textarea is focused. Defaults to false. */
  runWhileTyping?: boolean;
  /**
   * Keep the command out of the searchable palette list while it stays active as a
   * shortcut and remains listed in the help overlay. Defaults to false.
   */
  hideFromPalette?: boolean;
}

/** Commands grouped by their `group` field, preserving first-seen order. */
export interface CommandGroupView {
  group: string;
  items: Command[];
}
