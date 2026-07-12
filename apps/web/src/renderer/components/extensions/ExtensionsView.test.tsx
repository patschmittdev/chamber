/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import { ExtensionsView } from './ExtensionsView';

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
});
