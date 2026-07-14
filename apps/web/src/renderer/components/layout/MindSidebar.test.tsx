/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MindContext } from '@chamber/shared/types';
import { installElectronAPI, installMenuDom } from '../../../test/helpers';
import { AppStateProvider, useAppState } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { TooltipProvider } from '../ui/tooltip';
import { MindSidebar } from './MindSidebar';

installMenuDom();

const AGENTS_COLLAPSED_KEY = 'chamber:agents-collapsed';
const AGENTS_WIDTH_KEY = 'chamber:sidebarWidth';

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\agents\\monica',
  identity: { name: 'Monica', systemMessage: '# Monica' },
  status: 'ready',
};

function makeMind(mindId: string, name: string): MindContext {
  return { mindId, mindPath: `C:\\agents\\${name}`, identity: { name, systemMessage: `# ${name}` }, status: 'ready' };
}

function openOverflow(name: string): HTMLElement {
  const trigger = screen.getByRole('button', { name });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return trigger;
}

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

function ActiveViewProbe() {
  const { activeView } = useAppState();
  return <div data-testid="active-view">{activeView}</div>;
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
    expect(sidebar.className).toContain('duration-200');
    expect(screen.getByText('Add Agent')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collapse agents panel' })).toBeTruthy();
  });

  it('restores, pointer-resizes, and keyboard-resizes the persisted agents width', () => {
    localStorage.setItem(AGENTS_WIDTH_KEY, '240');
    renderSidebar();

    const sidebar = screen.getByLabelText('Agents');
    const resizeHandle = screen.getByRole('separator', { name: 'Resize agents panel' });
    expect(sidebar.style.width).toBe('240px');
    expect(resizeHandle.getAttribute('aria-valuenow')).toBe('240');

    fireEvent.pointerDown(resizeHandle, { button: 0, clientX: 100 });
    fireEvent.pointerMove(document, { clientX: 140 });
    fireEvent.pointerUp(document);
    expect(sidebar.style.width).toBe('280px');

    fireEvent.pointerDown(resizeHandle, { button: 0, clientX: 140 });
    expect(sidebar.className).toContain('transition-none');
    fireEvent.pointerCancel(document);
    expect(sidebar.className).toContain('duration-200');

    fireEvent.keyDown(resizeHandle, { key: 'ArrowLeft' });
    expect(sidebar.style.width).toBe('260px');
    expect(localStorage.getItem(AGENTS_WIDTH_KEY)).toBe('260');
  });

  it('collapses and expands via the toggle and persists the preference', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse agents panel' }));

    const sidebar = screen.getByLabelText('Agents');
    expect(sidebar.className).toContain('w-10');
    expect(sidebar.className).toContain('duration-200');
    expect(localStorage.getItem(AGENTS_COLLAPSED_KEY)).toBe('true');
    expect(screen.queryByText('Add Agent')).toBeNull();
    expect(screen.queryByRole('separator', { name: 'Resize agents panel' })).toBeNull();

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
    expect(screen.queryByRole('separator', { name: 'Resize agents panel' })).toBeNull();
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

  it('exposes row actions as a real button that is keyboard focusable and not nested in the row switch button (shell-F1)', () => {
    renderSidebar();

    const overflow = screen.getByRole('button', { name: 'More actions for Monica' });
    const switchButton = screen.getByRole('button', { name: 'Switch to Monica' });

    expect(overflow.tagName).toBe('BUTTON');
    expect(switchButton.contains(overflow)).toBe(false);

    overflow.focus();
    expect(document.activeElement).toBe(overflow);

    // The old invalid pattern nested span[role=button] controls inside the row
    // button. None should remain anywhere in the rail.
    expect(document.querySelectorAll('span[role="button"]').length).toBe(0);
  });

  it('reveals the row overflow control on focus-within (shell-F4/rail-H3)', () => {
    renderSidebar();
    const overflow = screen.getByRole('button', { name: 'More actions for Monica' });
    expect(overflow.className).toContain('group-focus-within:opacity-100');
    expect(overflow.className).toContain('focus-visible:opacity-100');
  });

  it('lists the agent actions in the overflow menu wired to the row handlers', async () => {
    const api = installElectronAPI();
    renderSidebar();

    openOverflow('More actions for Monica');
    expect(screen.getByRole('menuitem', { name: 'Manage agent' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Open in window' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in window' }));
    expect(api.mind.openWindow).toHaveBeenCalledWith('mind-1');
  });

  it('removes the agent from the overflow menu (shell-F1 danger action)', async () => {
    const api = installElectronAPI();
    renderSidebar();

    openOverflow('More actions for Monica');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove agent' }));
    expect(api.mind.remove).toHaveBeenCalledWith('mind-1');
  });

  it('opens a right-click context menu with the same agent actions (shell-F4/rail-H3)', () => {
    renderSidebar();

    expect(screen.queryByRole('menuitem', { name: 'Manage agent' })).toBeNull();
    fireEvent.contextMenu(screen.getByText('Monica'));

    expect(screen.getByRole('menuitem', { name: 'Manage agent' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Open in window' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Remove agent' })).toBeTruthy();
  });

  it('overlays row actions absolutely so the agent name reclaims full width (perf-D1)', () => {
    renderSidebar();

    const name = screen.getByText('Monica');
    expect(name.className).toContain('flex-1');
    expect(name.className).toContain('truncate');

    const overflow = screen.getByRole('button', { name: 'More actions for Monica' });
    expect(overflow.parentElement?.className).toContain('absolute');
  });

  it('filters the agents list by name (perf-D1)', () => {
    renderSidebar({
      minds: [mind, makeMind('mind-2', 'Bob'), makeMind('mind-3', 'Carol')],
      activeMindId: mind.mindId,
    });

    expect(screen.getByRole('button', { name: 'Switch to Monica' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch to Bob' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch to Carol' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Filter agents'), { target: { value: 'bob' } });

    expect(screen.queryByRole('button', { name: 'Switch to Monica' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch to Carol' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch to Bob' })).toBeTruthy();
  });

  it('gives the agent filter input the shared focus-ring utility', () => {
    renderSidebar();
    const filter = screen.getByLabelText('Filter agents');
    expect(filter.className).toContain('focus-ring');
  });

  it('preserves Extensions context when switching minds', () => {
    render(
      <AppStateProvider
        testInitialState={{
          minds: [mind, makeMind('mind-2', 'Bob')],
          activeMindId: mind.mindId,
          activeView: 'extensions',
        }}
      >
        <TooltipProvider>
          <MindSidebar />
          <ActiveViewProbe />
        </TooltipProvider>
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Bob' }));
    expect(screen.getByTestId('active-view').textContent).toBe('extensions');
  });
});
