/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { AppStateProvider } from '../../lib/store';
import { McpServersTab } from './McpServersTab';

describe('McpServersTab', () => {
  let api: ReturnType<typeof mockElectronAPI>;

  beforeEach(() => {
    api = mockElectronAPI();
  });

  it('shows redacted, mind-scoped connector state without configuration values', async () => {
    vi.mocked(api.mcp.listStatus).mockResolvedValue({
      connectors: [{
        name: 'files',
        transport: 'stdio',
        configuration: 'ready',
        connection: 'unknown',
      }],
      sourceStatus: 'ready',
    });
    installElectronAPI(api);
    render(
      <AppStateProvider testInitialState={{
        activeMindId: 'mind-1',
        minds: [{ mindId: 'mind-1', mindPath: 'C:\\minds\\lucy', identity: { name: 'Lucy', systemMessage: '' }, status: 'ready' }],
      }}>
        <McpServersTab />
      </AppStateProvider>,
    );

    await screen.findByText('files');
    expect(screen.getByText('Configuration ready')).toBeTruthy();
    expect(screen.getByText('Connection unknown')).toBeTruthy();
    expect(screen.queryByText('C:\\minds\\lucy')).toBeNull();
  });

  it('checks a ready connector, announces the bounded result, and refreshes inventory', async () => {
    const onInventoryChanged = vi.fn();
    vi.mocked(api.mcp.listStatus).mockResolvedValue({
      connectors: [{ name: 'files', transport: 'stdio', configuration: 'ready', connection: 'unknown' }],
      sourceStatus: 'ready',
    });
    vi.mocked(api.mcp.checkConnector).mockResolvedValue({ status: 'configuration-applied' });
    installElectronAPI(api);
    render(
      <AppStateProvider testInitialState={{ activeMindId: 'mind-1' }}>
        <McpServersTab onInventoryChanged={onInventoryChanged} />
      </AppStateProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Check configuration' }));

    await waitFor(() => expect(api.mcp.checkConnector).toHaveBeenCalledWith('files', 'mind-1'));
    await screen.findByText(/Configuration was applied. Connection health remains unknown until this connector is used/);
    expect(onInventoryChanged).toHaveBeenCalledOnce();
  });

  it('shows a retry only after a bounded reload failure', async () => {
    vi.mocked(api.mcp.listStatus).mockResolvedValue({
      connectors: [{ name: 'files', transport: 'stdio', configuration: 'ready', connection: 'unknown' }],
      sourceStatus: 'ready',
    });
    vi.mocked(api.mcp.checkConnector).mockResolvedValue({ status: 'reload-failed' });
    installElectronAPI(api);
    render(<AppStateProvider testInitialState={{ activeMindId: 'mind-1' }}><McpServersTab /></AppStateProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Check configuration' }));

    await screen.findByText('Chamber could not reload this connector configuration. Retry the check.');
    expect(screen.getByRole('button', { name: 'Retry configuration check' })).toBeTruthy();
  });

  it('blocks checks until required configuration is repaired', async () => {
    vi.mocked(api.mcp.listStatus).mockResolvedValue({
      connectors: [{ name: 'files', transport: 'unknown', configuration: 'needs-attention', connection: 'unknown' }],
      sourceStatus: 'needs-attention',
    });
    installElectronAPI(api);
    render(<AppStateProvider testInitialState={{ activeMindId: 'mind-1' }}><McpServersTab /></AppStateProvider>);

    const button = await screen.findByRole('button', { name: 'Check configuration' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/Connector configuration needs attention/)).toBeTruthy();
  });
});
