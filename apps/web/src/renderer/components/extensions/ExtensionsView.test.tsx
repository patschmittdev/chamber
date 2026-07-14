/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider, useAppState } from '../../lib/store';
import { ExtensionsView } from './ExtensionsView';

vi.mock('./SkillsTab', () => ({
  SkillsTab: () => <div>Skills content</div>,
}));

function renderView(api: ReturnType<typeof mockElectronAPI>) {
  installElectronAPI(api);
  return render(
    <AppStateProvider>
      <ExtensionsView />
    </AppStateProvider>,
  );
}

function StateProbe() {
  const { activeView, pendingSettingsIntent } = useAppState();
  return (
    <>
      <div data-testid="active-view">{activeView}</div>
      <div data-testid="pending-settings">{pendingSettingsIntent?.section ?? 'none'}</div>
    </>
  );
}

describe('ExtensionsView', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = mockElectronAPI();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the header and all five tabs', () => {
    renderView(api);
    expect(screen.getByRole('heading', { name: 'Extensions' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Prompts' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'MCP servers' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Tools' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Skills' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Lens views' })).toBeTruthy();
  });

  it('defaults to the Prompts tab to prioritize authoring flows', () => {
    renderView(api);
    expect(screen.getByRole('tab', { name: 'Prompts' }).getAttribute('data-state')).toBe('active');
    expect(screen.getByRole('tab', { name: 'MCP servers' }).getAttribute('data-state')).toBe('inactive');
  });

  it('switches to the Tools tab and loads the catalog', async () => {
    vi.mocked(api.tools.list).mockResolvedValue([]);
    renderView(api);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Tools' }));

    await waitFor(() => expect(api.tools.list).toHaveBeenCalled());
    expect(screen.getByText('No tools available')).toBeTruthy();
  });

  it('selects the Skills tab from a pending extensions intent', () => {
    installElectronAPI(api);
    render(
      <AppStateProvider testInitialState={{ pendingExtensionsIntent: { tab: 'skills' } }}>
        <ExtensionsView />
      </AppStateProvider>,
    );

    expect(screen.getByRole('tab', { name: 'Skills' }).getAttribute('data-state')).toBe('active');
    expect(screen.getByRole('tab', { name: 'MCP servers' }).getAttribute('data-state')).toBe('inactive');
  });

  it('shows elapsed reassurance while a one-shot action intent is pending', async () => {
    vi.useFakeTimers();
    installElectronAPI(api);
    render(
      <AppStateProvider testInitialState={{ pendingExtensionsIntent: { tab: 'skills', action: 'create-skill' } }}>
        <ExtensionsView />
      </AppStateProvider>,
    );

    expect(screen.getByRole('status').textContent).toContain('Applying shortcut action... 0:00');

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByRole('status').textContent).toContain('0:05');
  });

  it('shows explicit scope signaling for both global and mind-scoped tabs', () => {
    renderView(api);
    expect(screen.getByText('Scope: global (available to every mind)')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Skills' }));
    expect(screen.getByText('Scope: active mind only')).toBeTruthy();
  });

  it('cross-links to Settings > Marketplaces from Extensions', () => {
    installElectronAPI(api);
    render(
      <AppStateProvider testInitialState={{ activeView: 'extensions' }}>
        <ExtensionsView />
        <StateProbe />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manage marketplaces' }));
    expect(screen.getByTestId('active-view').textContent).toBe('settings');
    expect(screen.getByTestId('pending-settings').textContent).toBe('marketplaces');
  });
});
