/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { ToolsTab } from './ToolsTab';

const tool = {
  id: 'cool',
  displayName: 'Cool Tool',
  description: 'Does cool things',
  marketplaceId: 'acme/tools',
  marketplaceLabel: 'Acme Tools',
  installation: 'available' as const,
  updateAvailable: false,
};

describe('ToolsTab', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = mockElectronAPI();
  });

  it('installs a globally scoped tool through the redacted operation API and refreshes inventory', async () => {
    const onInventoryChanged = vi.fn();
    vi.mocked(api.tools.listOperations)
      .mockResolvedValueOnce({ tools: [tool], sources: [] })
      .mockResolvedValueOnce({ tools: [{ ...tool, installation: 'installed' as const }], sources: [] });
    vi.mocked(api.tools.install).mockResolvedValue({ status: 'completed', action: 'install' });
    installElectronAPI(api);
    render(<ToolsTab onInventoryChanged={onInventoryChanged} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Install Cool Tool' }));

    await waitFor(() => expect(api.tools.install).toHaveBeenCalledWith('cool', 'acme/tools'));
    await screen.findByText('Tool install completed.');
    expect(screen.getByText('Global')).toBeTruthy();
    expect(onInventoryChanged).toHaveBeenCalledOnce();
  });

  it('offers an update action when a newer bounded marketplace version is available', async () => {
    vi.mocked(api.tools.listOperations).mockResolvedValue({
      tools: [{ ...tool, installation: 'installed', updateAvailable: true }],
      sources: [],
    });
    vi.mocked(api.tools.update).mockResolvedValue({ status: 'completed', action: 'update' });
    installElectronAPI(api);
    render(<ToolsTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'Update Cool Tool' }));

    await waitFor(() => expect(api.tools.update).toHaveBeenCalledWith('cool', 'acme/tools'));
    await screen.findByText('Tool update completed.');
  });

  it('keeps a failed operation redacted and offers retry only after failure', async () => {
    vi.mocked(api.tools.listOperations).mockResolvedValue({ tools: [tool], sources: [] });
    vi.mocked(api.tools.install).mockResolvedValue({ status: 'failed', action: 'install' });
    installElectronAPI(api);
    render(<ToolsTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'Install Cool Tool' }));

    await screen.findByText('Tool install failed. Check marketplace access, then retry.');
    expect(screen.getByRole('button', { name: 'Retry install Cool Tool' })).toBeTruthy();
    expect(screen.queryByText('npm install -g')).toBeNull();
  });
});
