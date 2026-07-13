/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MindContext } from '@chamber/shared/types';
import { installElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { TooltipProvider } from '../ui/tooltip';
import { MindSidebar } from './MindSidebar';

const AGENTS_COLLAPSED_KEY = 'chamber:agents-collapsed';

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\agents\\monica',
  identity: { name: 'Monica', systemMessage: '# Monica' },
  status: 'ready',
};

function renderSidebar(overrides?: Partial<AppState>, props?: { autoCollapsed?: boolean }) {
  return render(
    <AppStateProvider
      testInitialState={{
        minds: [mind],
        activeMindId: mind.mindId,
        agentProfileByMindId: {
          [mind.mindId]: { mindId: mind.mindId, displayName: 'Monica', avatarDataUrl: null },
        },
        ...overrides,
      }}
    >
      <TooltipProvider>
        <MindSidebar {...props} />
      </TooltipProvider>
    </AppStateProvider>,
  );
}

describe('MindSidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    installElectronAPI();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders nothing when there are no minds', () => {
    renderSidebar({ minds: [], activeMindId: null });
    expect(screen.queryByLabelText('Agents')).toBeNull();
  });

  it('starts expanded with the agents list and a collapse control', () => {
    renderSidebar();
    const sidebar = screen.getByLabelText('Agents');
    expect(sidebar.className).not.toContain('w-10');
    expect(screen.getByText('Add Agent')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collapse agents panel' })).toBeTruthy();
  });

  it('collapses and expands via the toggle and persists the preference', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse agents panel' }));

    expect(screen.getByLabelText('Agents').className).toContain('w-10');
    expect(localStorage.getItem(AGENTS_COLLAPSED_KEY)).toBe('true');
    expect(screen.queryByText('Add Agent')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Expand agents panel' }));

    expect(screen.getByLabelText('Agents').className).not.toContain('w-10');
    expect(localStorage.getItem(AGENTS_COLLAPSED_KEY)).toBe('false');
  });

  it('restores a saved collapsed preference', () => {
    localStorage.setItem(AGENTS_COLLAPSED_KEY, 'true');
    renderSidebar();
    const sidebar = screen.getByLabelText('Agents');
    expect(sidebar.className).toContain('w-10');
    expect(screen.getByRole('button', { name: 'Expand agents panel' })).toBeTruthy();
  });

  it('locks collapsed and disables the toggle when the shell forces auto-collapse', () => {
    renderSidebar(undefined, { autoCollapsed: true });
    const sidebar = screen.getByLabelText('Agents');
    expect(sidebar.className).toContain('w-10');
    const expand = screen.getByRole('button', { name: 'Expand agents panel' }) as HTMLButtonElement;
    expect(expand.disabled).toBe(true);
  });

  it('keeps the collapse control keyboard focusable and operable', () => {
    renderSidebar();
    const collapse = screen.getByRole('button', { name: 'Collapse agents panel' });
    expect(collapse.tagName).toBe('BUTTON');
    collapse.focus();
    expect(document.activeElement).toBe(collapse);
    fireEvent.click(collapse);
    expect(screen.getByLabelText('Agents').className).toContain('w-10');
  });
});
