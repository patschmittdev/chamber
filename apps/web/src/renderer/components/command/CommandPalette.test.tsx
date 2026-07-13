/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MindContext } from '@chamber/shared/types';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { installElectronAPI } from '../../../test/helpers';
import { CommandPalette } from './CommandPalette';

// jsdom does not provide ResizeObserver; cmdk needs it.
class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
  MockResizeObserver;
// jsdom does not implement Element.scrollIntoView; cmdk calls it on focus.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\agents\\monica',
  identity: { name: 'Monica', systemMessage: '# Monica' },
  status: 'ready',
};

const PLACEHOLDER = 'Type a command or search...';
const SHORTCUTS_DESCRIPTION = 'Available commands and their keybindings.';

function renderPalette(testInitialState?: Partial<AppState>) {
  return render(
    <AppStateProvider testInitialState={testInitialState}>
      <CommandPalette />
    </AppStateProvider>,
  );
}

function pressCtrlK() {
  fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    installElectronAPI();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('is closed until the Ctrl+K shortcut is pressed', () => {
    renderPalette({ activeMindId: mind.mindId, minds: [mind] });
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();

    pressCtrlK();

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeTruthy();
  });

  it('also opens with the Meta+K shortcut for macOS', () => {
    renderPalette({ minds: [mind] });

    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeTruthy();
  });

  it('toggles closed when Ctrl+K is pressed again', () => {
    renderPalette({ activeMindId: mind.mindId, minds: [mind] });

    pressCtrlK();
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeTruthy();

    pressCtrlK();
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();
  });

  it('closes when Escape is pressed', async () => {
    renderPalette({ activeMindId: mind.mindId, minds: [mind] });

    pressCtrlK();
    const input = screen.getByPlaceholderText(PLACEHOLDER);

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();
    });
  });

  it('exposes an accessible label on the search input', () => {
    renderPalette({ activeMindId: mind.mindId, minds: [mind] });

    pressCtrlK();

    const input = screen.getByPlaceholderText(PLACEHOLDER);
    expect(input.getAttribute('aria-label')).toBe('Search commands');
  });

  it('filters the visible commands as the user types', async () => {
    renderPalette({ activeMindId: null, minds: [] });

    pressCtrlK();
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'settings' } });

    await waitFor(() => {
      const labels = screen.getAllByRole('option').map((option) => option.textContent);
      expect(labels).toContain('Open Settings');
      expect(labels).not.toContain('Open Chat');
      expect(labels).not.toContain('Open Chatroom');
    });
  });

  it('hides the new conversation command while the active mind is streaming', async () => {
    renderPalette({
      activeMindId: mind.mindId,
      minds: [mind],
      streamingByMind: { [mind.mindId]: true },
    });

    pressCtrlK();
    await screen.findByPlaceholderText(PLACEHOLDER);

    expect(screen.getByText('Open Chat')).toBeTruthy();
    expect(screen.queryByText('New conversation')).toBeNull();
  });

  it('opens the keyboard shortcuts overlay when the ? shortcut is pressed', async () => {
    renderPalette({ activeMindId: mind.mindId, minds: [mind] });
    expect(screen.queryByText(SHORTCUTS_DESCRIPTION)).toBeNull();

    fireEvent.keyDown(document.body, { key: '?' });

    expect(await screen.findByText(SHORTCUTS_DESCRIPTION)).toBeTruthy();
    expect(screen.getByText('Command palette')).toBeTruthy();
  });

  it('replaces the shortcuts overlay with the palette when Ctrl+K follows ?', async () => {
    renderPalette({ activeMindId: mind.mindId, minds: [mind] });

    fireEvent.keyDown(document.body, { key: '?' });
    await screen.findByText(SHORTCUTS_DESCRIPTION);

    pressCtrlK();

    await waitFor(() => {
      expect(screen.queryByText(SHORTCUTS_DESCRIPTION)).toBeNull();
    });
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeTruthy();
  });
});
