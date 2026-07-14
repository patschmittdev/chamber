/**
 * @vitest-environment jsdom
 */
import React, { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeLensViewManifest } from '../../../test/helpers';
import { AppStateProvider, useAppState } from '../../lib/store';
import { ViewRouter } from './ViewRouter';

vi.mock('../chat/ChatPanel', () => ({
  ChatPanel: () => <div>Chat panel</div>,
}));

vi.mock('../views/LensViewRenderer', () => ({
  LensViewRenderer: ({ view }: { view: { name: string } }) => <div>Lens panel: {view.name}</div>,
}));

vi.mock('../settings/SettingsView', () => ({
  SettingsView: () => <div>Settings panel</div>,
}));

function ActiveViewProbe({ onChange }: { onChange: (activeView: string) => void }) {
  const { activeView } = useAppState();
  useEffect(() => {
    onChange(activeView);
  }, [activeView, onChange]);
  return null;
}

describe('ViewRouter', () => {
  it('migrates legacy activity view state back to chat', async () => {
    const onActiveViewChange = vi.fn();
    render(
      <AppStateProvider testInitialState={{ activeView: 'activity' }}>
        <ActiveViewProbe onChange={onActiveViewChange} />
        <ViewRouter />
      </AppStateProvider>,
    );

    expect(screen.getByText('Chat panel')).toBeTruthy();
    await waitFor(() => {
      expect(onActiveViewChange).toHaveBeenCalledWith('chat');
    });
  });

  it('falls back to chat when the active Lens view is disabled', async () => {
    const onActiveViewChange = vi.fn();
    render(
      <AppStateProvider testInitialState={{
        activeMindId: 'mind-a',
        activeView: 'briefing',
        discoveredViews: [makeLensViewManifest({ id: 'briefing', name: 'Briefing' })],
        disabledLensViewKeys: ['mind-a:briefing'],
      }}>
        <ActiveViewProbe onChange={onActiveViewChange} />
        <ViewRouter />
      </AppStateProvider>,
    );

    expect(screen.getByText('Chat panel')).toBeTruthy();
    await waitFor(() => {
      expect(onActiveViewChange).toHaveBeenCalledWith('chat');
    });
  });

  it('renders enabled Lens views', () => {
    render(
      <AppStateProvider testInitialState={{
        activeMindId: 'mind-a',
        activeView: 'briefing',
        discoveredViews: [makeLensViewManifest({ id: 'briefing', name: 'Briefing' })],
      }}>
        <ViewRouter />
      </AppStateProvider>,
    );

    expect(screen.getByText('Lens panel: Briefing')).toBeTruthy();
  });

  it('lazy-loads heavy panels behind a suspense fallback', async () => {
    render(
      <AppStateProvider testInitialState={{ activeView: 'settings' }}>
        <ViewRouter />
      </AppStateProvider>,
    );

    expect(screen.getByRole('status').textContent).toContain('Loading view');
    await waitFor(() => {
      expect(screen.getByText('Settings panel')).toBeTruthy();
    });
  });
});
