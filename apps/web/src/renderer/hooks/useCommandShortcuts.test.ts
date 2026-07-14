/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useCommandShortcuts } from './useCommandShortcuts';
import type { Command } from '../lib/commands';

function command(overrides: Partial<Command> & Pick<Command, 'id' | 'run'>): Command {
  return { title: overrides.id, group: 'General', ...overrides };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('useCommandShortcuts', () => {
  it('runs the command whose chord matches the event', () => {
    const run = vi.fn();
    renderHook(() => useCommandShortcuts([command({ id: 'palette', run, keybinding: { mod: true, key: 'k' } })]));

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('ignores events that match no command', () => {
    const run = vi.fn();
    renderHook(() => useCommandShortcuts([command({ id: 'palette', run, keybinding: { mod: true, key: 'k' } })]));

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, bubbles: true }));

    expect(run).not.toHaveBeenCalled();
  });

  it('suppresses a plain-key shortcut while an input is focused', () => {
    const run = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    renderHook(() => useCommandShortcuts([command({ id: 'help', run, keybinding: { key: '?' } })]));

    input.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));

    expect(run).not.toHaveBeenCalled();
  });

  it('still fires a runWhileTyping shortcut while an input is focused', () => {
    const run = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    renderHook(() =>
      useCommandShortcuts([command({ id: 'palette', run, keybinding: { mod: true, key: 'k' }, runWhileTyping: true })]),
    );

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('fires a mod chord while a textarea composer is focused', () => {
    const run = vi.fn();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    renderHook(() =>
      useCommandShortcuts([command({ id: 'new-conversation', run, keybinding: { mod: true, shift: true, key: 'o' } })]),
    );

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, shiftKey: true, bubbles: true }),
    );

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps suppressing a plain-key shortcut while a textarea composer is focused', () => {
    const run = vi.fn();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();
    renderHook(() => useCommandShortcuts([command({ id: 'help', run, keybinding: { key: '?' } })]));

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));

    expect(run).not.toHaveBeenCalled();
  });
});
