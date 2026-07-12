/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCatalogEntry } from '@chamber/shared/types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { ToolsTab } from './ToolsTab';

function makeTool(overrides?: Partial<ToolCatalogEntry>): ToolCatalogEntry {
  return {
    id: 'cool',
    displayName: 'Cool Tool',
    description: 'Does cool things',
    install: { type: 'npm-global', package: 'cool-tool', version: '1.0.0' },
    bin: 'cool',
    source: {
      owner: 'acme',
      repo: 'tools',
      ref: 'main',
      plugin: 'tools',
      marketplaceId: 'acme/tools',
      marketplaceLabel: 'Acme Tools',
      marketplaceUrl: 'https://github.com/acme/tools',
    },
    status: 'available',
    ...overrides,
  };
}

describe('ToolsTab', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = mockElectronAPI();
  });

  it('renders an empty state when the catalog is empty', async () => {
    vi.mocked(api.tools.list).mockResolvedValue([]);
    installElectronAPI(api);
    render(<ToolsTab />);
    await waitFor(() => expect(screen.getByText('No tools available')).toBeTruthy());
  });

  it('installs an available tool through the tools service', async () => {
    vi.mocked(api.tools.list)
      .mockResolvedValueOnce([makeTool()])
      .mockResolvedValueOnce([makeTool({ status: 'installed', installedVersion: '1.0.0' })]);
    vi.mocked(api.tools.install).mockResolvedValue({
      success: true,
      tool: {
        id: 'cool',
        version: '1.0.0',
        bin: 'cool',
        displayName: 'Cool Tool',
        description: 'Does cool things',
        source: { marketplaceId: 'acme/tools', pluginId: 'tools' },
        installedAt: new Date().toISOString(),
        package: 'cool-tool',
      },
    });
    installElectronAPI(api);
    render(<ToolsTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'Install Cool Tool' }));

    await waitFor(() => expect(api.tools.install).toHaveBeenCalledWith('cool', 'acme/tools'));
    await waitFor(() => expect(screen.getByText('Installed · 1.0.0')).toBeTruthy());
  });

  it('uninstalls an installed tool through the tools service', async () => {
    vi.mocked(api.tools.list)
      .mockResolvedValueOnce([makeTool({ status: 'installed', installedVersion: '1.0.0' })])
      .mockResolvedValueOnce([makeTool()]);
    vi.mocked(api.tools.uninstall).mockResolvedValue({ success: true });
    installElectronAPI(api);
    render(<ToolsTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'Uninstall Cool Tool' }));

    await waitFor(() => expect(api.tools.uninstall).toHaveBeenCalledWith('cool'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install Cool Tool' })).toBeTruthy());
  });

  it('surfaces an install failure message', async () => {
    vi.mocked(api.tools.list).mockResolvedValue([makeTool()]);
    vi.mocked(api.tools.install).mockResolvedValue({ success: false, error: 'npm exploded' });
    installElectronAPI(api);
    render(<ToolsTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'Install Cool Tool' }));

    await waitFor(() => expect(screen.getByText('npm exploded')).toBeTruthy());
  });
});
