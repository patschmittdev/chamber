/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installElectronAPI, makeLensViewManifest } from '../../../test/helpers';
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
      discoveredViews: [
        makeLensViewManifest({ id: 'daily', name: 'Daily Briefing', view: 'briefing', description: 'Morning digest' }),
      ],
    });

    expect(screen.getByText('Daily Briefing')).toBeTruthy();
    expect(screen.getByText('briefing')).toBeTruthy();
    expect(screen.getByText('Morning digest')).toBeTruthy();
  });
});
