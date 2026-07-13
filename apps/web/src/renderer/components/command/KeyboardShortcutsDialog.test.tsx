/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Command } from '../../lib/commands';
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog';

const SHORTCUTS_DESCRIPTION = 'Available commands and their keybindings.';

const noop = () => {};

const commands: Command[] = [
  { id: 'palette', title: 'Command palette', group: 'General', run: noop, keybinding: { mod: true, key: 'k' } },
  { id: 'shortcuts', title: 'Keyboard shortcuts', group: 'General', run: noop, keybinding: { key: '?' } },
  { id: 'open-settings', title: 'Open Settings', group: 'Views', run: noop },
];

afterEach(cleanup);

describe('KeyboardShortcutsDialog', () => {
  it('renders nothing while closed', () => {
    render(<KeyboardShortcutsDialog open={false} onOpenChange={vi.fn()} commands={commands} />);

    expect(screen.queryByText(SHORTCUTS_DESCRIPTION)).toBeNull();
  });

  it('lists commands that carry a keybinding, grouped, with their chord tokens', () => {
    render(<KeyboardShortcutsDialog open onOpenChange={vi.fn()} commands={commands} />);

    expect(screen.getByText(SHORTCUTS_DESCRIPTION)).toBeTruthy();
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByText('Command palette')).toBeTruthy();

    const tokens = Array.from(document.querySelectorAll('kbd')).map((node) => node.textContent);
    expect(tokens).toContain('K');
    expect(tokens).toContain('?');
  });

  it('lists commands without a keybinding and marks them Unassigned', () => {
    render(<KeyboardShortcutsDialog open onOpenChange={vi.fn()} commands={commands} />);

    expect(screen.getByText('Open Settings')).toBeTruthy();
    expect(screen.getByText('Views')).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
  });
});
