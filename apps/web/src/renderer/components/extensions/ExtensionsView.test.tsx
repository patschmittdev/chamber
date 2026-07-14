/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
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

describe('ExtensionsView', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = mockElectronAPI();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the header and all four tabs', () => {
    renderView(api);
    expect(screen.getByRole('heading', { name: 'Extensions' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'MCP servers' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Tools' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Skills' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Lens views' })).toBeTruthy();
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
});
