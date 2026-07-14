/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { MindContext } from '@chamber/shared/types';
import { installElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { AppShell } from './AppShell';

// The shell smoke exercises the responsive rails only; the heavy main content
// and app-wide subscriptions are orthogonal to layout, so stub them out.
vi.mock('../../hooks/useAppSubscriptions', () => ({ useAppSubscriptions: () => undefined }));
vi.mock('./ViewRouter', () => ({ ViewRouter: () => <div data-testid="view-router" /> }));
vi.mock('../command/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('./MacTitlebarDrag', () => ({ MacTitlebarDrag: () => null }));

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\agents\\monica',
  identity: { name: 'Monica', systemMessage: '# Monica' },
  status: 'ready',
};

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  window.dispatchEvent(new Event('resize'));
}

function renderShell(overrides?: Partial<AppState>) {
  return render(
    <AppStateProvider
      testInitialState={{
        minds: [mind],
        activeMindId: null,
        agentProfileByMindId: {
          [mind.mindId]: { mindId: mind.mindId, displayName: 'Monica', avatarDataUrl: null },
        },
        ...overrides,
      }}
    >
      <AppShell />
    </AppStateProvider>,
  );
}

describe('AppShell layout', () => {
  const originalWidth = window.innerWidth;

  beforeEach(() => {
    localStorage.clear();
    installElectronAPI();
    setViewportWidth(1440);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true, writable: true });
  });

  it('renders the activity bar, both side rails, and the main content region', () => {
    renderShell();
    expect(screen.getByLabelText('Settings')).toBeTruthy();
    expect(screen.getByLabelText('Agents')).toBeTruthy();
    expect(screen.getByLabelText('Conversation history')).toBeTruthy();
    expect(screen.getByTestId('view-router')).toBeTruthy();
  });

  it('mounts exactly one app-wide notification host', () => {
    renderShell();
    expect(screen.getAllByTestId('toaster')).toHaveLength(1);
  });

  it('keeps both side rails expanded at desktop width', () => {
    setViewportWidth(1440);
    renderShell();
    expect(screen.getByLabelText('Agents').className).not.toContain('w-10');
    expect(screen.getByLabelText('Conversation history').className).toContain('w-80');
  });

  it('auto-collapses only the history rail below the lg breakpoint', () => {
    setViewportWidth(900);
    renderShell();
    expect(screen.getByLabelText('Conversation history').className).toContain('w-10');
    expect(screen.getByLabelText('Agents').className).not.toContain('w-10');
  });

  it('auto-collapses both side rails below the md breakpoint', () => {
    setViewportWidth(700);
    renderShell();
    expect(screen.getByLabelText('Agents').className).toContain('w-10');
    expect(screen.getByLabelText('Conversation history').className).toContain('w-10');
  });

  it('reflows the rails when the viewport shrinks after mount', () => {
    setViewportWidth(1440);
    renderShell();
    expect(screen.getByLabelText('Agents').className).not.toContain('w-10');

    act(() => setViewportWidth(700));
    expect(screen.getByLabelText('Agents').className).toContain('w-10');
    expect(screen.getByLabelText('Conversation history').className).toContain('w-10');
  });
});
