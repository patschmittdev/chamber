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

function ActiveViewProbe({ onChange }: { onChange: (activeView: string) => void }) {
  const { activeView } = useAppState();
  useEffect(() => {
    onChange(activeView);
  }, [activeView, onChange]);
  return null;
}

describe('ViewRouter', () => {
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
});
