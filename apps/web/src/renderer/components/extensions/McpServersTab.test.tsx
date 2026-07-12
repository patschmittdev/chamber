/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindContext } from '@chamber/shared/types';
import type { McpServerEntry } from '@chamber/shared/mcp-types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import type { AppState } from '../../lib/store/state';
import { McpServersTab } from './McpServersTab';

const mind: MindContext = {
  mindId: 'mind-1',
  mindPath: 'C:\\minds\\lucy',
  identity: { name: 'Lucy', systemMessage: '' },
  status: 'ready',
};

function renderTab(api: ReturnType<typeof mockElectronAPI>, state?: Partial<AppState>) {
  installElectronAPI(api);
  return render(
    <AppStateProvider testInitialState={{ activeMindId: 'mind-1', minds: [mind], ...state }}>
      <McpServersTab />
    </AppStateProvider>,
  );
}

describe('McpServersTab', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = mockElectronAPI();
  });

  it('prompts to select a mind when none is active', () => {
    renderTab(api, { activeMindId: null, minds: [] });
    expect(screen.getByText('No mind selected')).toBeTruthy();
  });

  it('lists the configured servers for the active mind', async () => {
    vi.mocked(api.mcp.getServers).mockResolvedValue([
      { name: 'files', transport: 'stdio', command: 'npx', args: ['fs'], env: {} },
      { name: 'remote', transport: 'http', url: 'https://mcp.example.test', headers: {} },
    ]);
    renderTab(api);

    await waitFor(() => expect(screen.getByText('files')).toBeTruthy());
    expect(api.mcp.getServers).toHaveBeenCalledWith('mind-1');
    expect(screen.getByText('remote')).toBeTruthy();
    expect(screen.getByText('https://mcp.example.test')).toBeTruthy();
  });

  it('adds a new stdio server and persists it', async () => {
    vi.mocked(api.mcp.getServers).mockResolvedValue([]);
    const saved: McpServerEntry[] = [{ name: 'files', transport: 'stdio', command: 'npx', args: ['fs'], env: {} }];
    vi.mocked(api.mcp.setServers).mockResolvedValue(saved);
    renderTab(api);

    await screen.findByText('MCP servers');
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'files' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } });
    fireEvent.change(screen.getByLabelText('Arguments'), { target: { value: 'fs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save server' }));

    await waitFor(() => {
      expect(api.mcp.setServers).toHaveBeenCalledWith(
        [{ name: 'files', transport: 'stdio', command: 'npx', args: ['fs'], env: {} }],
        'mind-1',
      );
    });
    await waitFor(() => expect(screen.getByText('files')).toBeTruthy());
  });

  it('shows a validation error and does not persist an empty name', async () => {
    vi.mocked(api.mcp.getServers).mockResolvedValue([]);
    renderTab(api);

    await screen.findByText('MCP servers');
    fireEvent.click(screen.getByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save server' }));

    await waitFor(() => expect(screen.getByText('Name is required.')).toBeTruthy());
    expect(api.mcp.setServers).not.toHaveBeenCalled();
  });

  it('removes a server and persists the remaining set', async () => {
    vi.mocked(api.mcp.getServers).mockResolvedValue([
      { name: 'files', transport: 'stdio', command: 'npx', args: [], env: {} },
    ]);
    vi.mocked(api.mcp.setServers).mockResolvedValue([]);
    renderTab(api);

    await screen.findByText('files');
    fireEvent.click(screen.getByRole('button', { name: 'Remove files' }));

    await waitFor(() => expect(api.mcp.setServers).toHaveBeenCalledWith([], 'mind-1'));
  });
});
