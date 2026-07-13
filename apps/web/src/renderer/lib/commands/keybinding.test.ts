import { describe, it, expect } from 'vitest';
import { eventMatchesKeybinding, keybindingConflictKey, keybindingTokens } from './keybinding';
import type { Keybinding } from './types';

function keyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: 'k',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe('eventMatchesKeybinding', () => {
  const modK: Keybinding = { mod: true, key: 'k' };

  it('matches the platform accelerator with either Ctrl or Cmd', () => {
    expect(eventMatchesKeybinding(keyEvent({ ctrlKey: true }), modK)).toBe(true);
    expect(eventMatchesKeybinding(keyEvent({ metaKey: true }), modK)).toBe(true);
  });

  it('requires the accelerator for a mod binding', () => {
    expect(eventMatchesKeybinding(keyEvent({}), modK)).toBe(false);
  });

  it('ignores letter case so Shift does not break a mod chord', () => {
    expect(eventMatchesKeybinding(keyEvent({ ctrlKey: true, key: 'K', shiftKey: true }), modK)).toBe(true);
  });

  it('never fires a mod binding while Alt is held', () => {
    expect(eventMatchesKeybinding(keyEvent({ ctrlKey: true, altKey: true }), modK)).toBe(false);
  });

  it('matches a plain key even when the layout reports Shift for the symbol', () => {
    const help: Keybinding = { key: '?' };
    expect(eventMatchesKeybinding(keyEvent({ key: '?', shiftKey: true }), help)).toBe(true);
  });

  it('rejects a plain key while the accelerator is held', () => {
    const help: Keybinding = { key: '?' };
    expect(eventMatchesKeybinding(keyEvent({ key: '?', ctrlKey: true }), help)).toBe(false);
  });

  it('enforces Shift only when the binding declares it', () => {
    const modShiftK: Keybinding = { mod: true, shift: true, key: 'k' };
    expect(eventMatchesKeybinding(keyEvent({ ctrlKey: true, shiftKey: true, key: 'K' }), modShiftK)).toBe(true);
    expect(eventMatchesKeybinding(keyEvent({ ctrlKey: true, key: 'k' }), modShiftK)).toBe(false);
  });
});

describe('keybindingConflictKey', () => {
  it('orders mod and alt before the key', () => {
    expect(keybindingConflictKey({ mod: true, alt: true, key: 'K' })).toBe('mod+alt+k');
  });

  it('excludes shift so a shift variant shares its base chord key', () => {
    expect(keybindingConflictKey({ mod: true, shift: true, key: 'k' })).toBe('mod+k');
    expect(keybindingConflictKey({ mod: true, key: 'k' })).toBe('mod+k');
  });

  it('reduces a plain key to just the key', () => {
    expect(keybindingConflictKey({ key: '?' })).toBe('?');
  });
});

describe('keybindingTokens', () => {
  it('shows Cmd and Option on macOS', () => {
    expect(keybindingTokens({ mod: true, alt: true, key: 'k' }, true)).toEqual(['Cmd', 'Option', 'K']);
  });

  it('shows Ctrl and Alt elsewhere', () => {
    expect(keybindingTokens({ mod: true, alt: true, key: 'k' }, false)).toEqual(['Ctrl', 'Alt', 'K']);
  });

  it('renders a plain key as a single token', () => {
    expect(keybindingTokens({ key: '?' }, false)).toEqual(['?']);
  });
});
