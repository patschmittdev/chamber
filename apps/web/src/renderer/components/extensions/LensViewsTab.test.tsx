/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { installElectronAPI, makeLensViewManifest, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { LensViewsTab } from './LensViewsTab';

function renderTab(state?: Partial<AppState>) {
  installElectronAPI();
  return render(
    <AppStateProvider testInitialState={state}>
      <LensViewsTab />
    </AppStateProvider>,
  );
}

describe('LensViewsTab', () => {
  it('renders an empty state when no views are discovered', () => {
    renderTab({ discoveredViews: [] });
    expect(screen.getByText('No Lens views discovered')).toBeTruthy();
  });

  it('lists the discovered views from the store', () => {
    renderTab({
      activeMindId: 'mind-a',
      discoveredViews: [
        makeLensViewManifest({ id: 'daily', name: 'Daily Briefing', view: 'briefing', description: 'Morning digest' }),
      ],
    });

    expect(screen.getByText('Daily Briefing')).toBeTruthy();
    expect(screen.getByText('briefing')).toBeTruthy();
    expect(screen.getByText('Morning digest')).toBeTruthy();
  });

  it('disables a Lens view without removing it from the catalog', async () => {
    const api = mockElectronAPI();
    api.lens.setViewEnabled = vi.fn().mockResolvedValue({ mindId: 'mind-a', viewId: 'daily', enabled: false });
    installElectronAPI(api);
    render(
      <AppStateProvider testInitialState={{
        activeMindId: 'mind-a',
        discoveredViews: [
          makeLensViewManifest({ id: 'daily', name: 'Daily Briefing', view: 'briefing' }),
        ],
      }}>
        <LensViewsTab />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Disable Daily Briefing' }));

    await waitFor(() => {
      expect(api.lens.setViewEnabled).toHaveBeenCalledWith('daily', false, 'mind-a');
      expect(screen.getByText('Daily Briefing')).toBeTruthy();
      expect(screen.getByText('Disabled')).toBeTruthy();
    });
  });

  it('re-enables a disabled Lens view', async () => {
    const api = mockElectronAPI();
    api.lens.setViewEnabled = vi.fn().mockResolvedValue({ mindId: 'mind-a', viewId: 'daily', enabled: true });
    installElectronAPI(api);
    render(
      <AppStateProvider testInitialState={{
        activeMindId: 'mind-a',
        disabledLensViewKeys: ['mind-a:daily'],
        discoveredViews: [
          makeLensViewManifest({ id: 'daily', name: 'Daily Briefing', view: 'briefing' }),
        ],
      }}>
        <LensViewsTab />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Daily Briefing' }));

    await waitFor(() => {
      expect(api.lens.setViewEnabled).toHaveBeenCalledWith('daily', true, 'mind-a');
      expect(screen.getByText('Enabled')).toBeTruthy();
    });
  });

  it('surfaces an inline error when toggling a view fails', async () => {
    const api = mockElectronAPI();
    api.lens.setViewEnabled = vi.fn().mockRejectedValue(new Error('disk full'));
    installElectronAPI(api);
    render(
      <AppStateProvider testInitialState={{
        activeMindId: 'mind-a',
        discoveredViews: [
          makeLensViewManifest({ id: 'daily', name: 'Daily Briefing', view: 'briefing' }),
        ],
      }}>
        <LensViewsTab />
      </AppStateProvider>,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Disable Daily Briefing' }));

    await waitFor(() => {
      expect(screen.getByText('Failed to update view visibility. Please try again.')).toBeTruthy();
    });
  });
});
