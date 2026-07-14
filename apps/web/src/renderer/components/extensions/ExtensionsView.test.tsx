/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityInventoryItem } from '@chamber/shared';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider, useAppState } from '../../lib/store';
import { ExtensionsView } from './ExtensionsView';

vi.mock('./SkillsTab', () => ({
  SkillsTab: () => <div>Skills management</div>,
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

  it('loads the renderer-safe inventory for the active mind and renders all five categories', async () => {
    vi.mocked(api.capabilities.list).mockResolvedValue({
      items: [capability({ ref: { kind: 'skill', id: 'writer', scope: { kind: 'mind', mindId: 'mind-1' } } })],
      sources: [],
    });
    installElectronAPI(api);
    render(
      <AppStateProvider testInitialState={{ activeMindId: 'mind-1' }}>
        <ExtensionsView />
      </AppStateProvider>,
    );

    await waitFor(() => expect(api.capabilities.list).toHaveBeenCalledWith({ mindId: 'mind-1', availability: 'all' }));
    expect(screen.getByRole('heading', { name: 'Extensions' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Skills 1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Connectors 0' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Tools 0' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Prompts 0' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Lens views 0' })).toBeTruthy();
  });

  it('defaults to the installed Skills category', async () => {
    renderView(api);

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Skills 0' })).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'Skills 0' }).getAttribute('data-state')).toBe('active');
    expect(screen.getByRole('tab', { name: 'Connectors 0' }).getAttribute('data-state')).toBe('inactive');
  });

  it('filters inventory cards and summary counts by category and lifecycle', async () => {
    vi.mocked(api.capabilities.list).mockResolvedValue({
      items: [
        capability(),
        capability({
          ref: { kind: 'cli-tool', id: 'tool', scope: { kind: 'global' } },
          displayName: 'Formatter',
          lifecycle: { installation: 'available', activation: 'disabled', availability: 'available' },
        }),
      ],
      sources: [],
    });
    renderView(api);

    await screen.findByText('Writer');
    expect(screen.getByText('1 installed')).toBeTruthy();
    expect(screen.getByText('1 available')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Tools 1' }));
    expect(screen.getByText('Formatter')).toBeTruthy();
    expect(screen.queryByText('Writer')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Available 1' }));
    expect(screen.getByText('1 available tool')).toBeTruthy();
  });

  it('selects the Skills category from a pending extensions intent', async () => {
    installElectronAPI(api);
    render(
      <AppStateProvider testInitialState={{ pendingExtensionsIntent: { tab: 'skills' } }}>
        <ExtensionsView />
      </AppStateProvider>,
    );

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Skills 0' }).getAttribute('data-state')).toBe('active'));
    expect(screen.getByRole('tab', { name: 'Connectors 0' }).getAttribute('data-state')).toBe('inactive');
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

  it('shows bounded scope, provenance, lifecycle, and health details', async () => {
    vi.mocked(api.capabilities.list).mockResolvedValue({
      items: [
        capability({
          provenance: { kind: 'marketplace', label: 'Acme marketplace' },
          health: { status: 'degraded', code: 'required-files' },
          requirements: [{ label: 'Required skill files', status: 'unmet' }],
        }),
        capability({
          ref: { kind: 'prompt', id: 'daily', scope: { kind: 'global' } },
          displayName: 'Daily summary',
          lifecycle: { installation: 'installed', activation: 'enabled', availability: 'unavailable' },
        }),
      ],
      sources: [],
    });
    renderView(api);

    await screen.findByText('Writer');
    expect(screen.getByText('Mind scoped')).toBeTruthy();
    expect(screen.getByText('Source: Acme marketplace')).toBeTruthy();
    expect(screen.getByText('Health: Degraded')).toBeTruthy();
    expect(screen.getByText('Required skill files: Unmet')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Prompts 1' }));
    expect(screen.getByText('Global')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
  });

  it('preserves safe declarations and compatibility for curated directory details', async () => {
    vi.mocked(api.capabilities.list).mockResolvedValue({
      items: [capability({
        ref: { kind: 'cli-tool', id: 'catalog:release-helper', scope: { kind: 'global' } },
        displayName: 'Release Helper',
        provenance: { kind: 'marketplace', label: 'Enrolled catalog' },
        lifecycle: { installation: 'available', activation: 'disabled', availability: 'available' },
        compatibility: { status: 'incompatible' },
        declaredCapabilities: [{ id: 'release-notes', label: 'Release notes' }],
      })],
      sources: [],
    });
    renderView(api);

    fireEvent.click(await screen.findByRole('button', { name: 'View details for Release Helper' }));
    expect(screen.getByText('release-notes')).toBeTruthy();
    expect(screen.getByText('Incompatible')).toBeTruthy();
  });

  it('shows a loading state while the inventory is pending', () => {
    vi.mocked(api.capabilities.list).mockReturnValue(new Promise(() => {}));
    renderView(api);
    expect(screen.getByText('Loading installed capabilities...')).toBeTruthy();
  });

  it('shows a bounded error without exposing a raw inventory failure', async () => {
    vi.mocked(api.capabilities.list).mockRejectedValue(new Error('C:\\secret\\inventory failure'));
    renderView(api);

    await waitFor(() => expect(screen.getByText('Could not load installed capabilities. Try again.')).toBeTruthy());
    expect(screen.queryByText('C:\\secret\\inventory failure')).toBeNull();
  });

  it('shows an empty state for a category with no matching installed capabilities', async () => {
    vi.mocked(api.capabilities.list).mockResolvedValue({ items: [], sources: [] });
    renderView(api);

    await waitFor(() => expect(screen.getByText('No installed skills')).toBeTruthy());
  });

  it('keeps source-specific actions available from a category', async () => {
    renderView(api);
    await screen.findByRole('tab', { name: 'Skills 0' });

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Prompts 0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage prompts' }));
    await screen.findByRole('button', { name: 'New prompt' });

    fireEvent.click(screen.getByRole('button', { name: 'New prompt' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Daily summary' } });
    fireEvent.change(screen.getByLabelText('Prompt body'), { target: { value: 'Summarize today.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }));

    await waitFor(() => expect(api.prompts.save).toHaveBeenCalled());
    await waitFor(() => expect(api.capabilities.list).toHaveBeenCalledTimes(2));
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

function capability(overrides: Partial<CapabilityInventoryItem> = {}): CapabilityInventoryItem {
  return {
    ref: { kind: 'skill', id: 'writer', scope: { kind: 'mind', mindId: 'mind-1' } },
    displayName: 'Writer',
    description: 'Writes concise updates.',
    provenance: { kind: 'local', label: 'Mind local files' },
    lifecycle: { installation: 'installed', activation: 'enabled', availability: 'available' },
    requirements: [],
    compatibility: { status: 'compatible' },
    declaredCapabilities: [],
    health: { status: 'healthy' },
    ...overrides,
  };
}
