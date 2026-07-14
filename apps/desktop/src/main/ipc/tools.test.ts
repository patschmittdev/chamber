import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '@chamber/shared';
import { setupToolsIPC } from './tools';

const EVT = {} as IpcMainInvokeEvent;
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

describe('Tools IPC', () => {
  const tools = {
    list: vi.fn(),
    install: vi.fn(),
    uninstall: vi.fn(),
    listOperations: vi.fn(),
    installForOperator: vi.fn(),
    updateForOperator: vi.fn(),
    removeForOperator: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    tools.listOperations.mockResolvedValue({ tools: [], sources: [] });
    tools.installForOperator.mockResolvedValue({ status: 'completed', action: 'install' });
    setupToolsIPC(tools as never);
  });

  it('uses a dedicated redacted list operation', async () => {
    await expect(getHandler(IPC.TOOLS.LIST_OPERATIONS)(EVT)).resolves.toEqual({ tools: [], sources: [] });
    expect(tools.listOperations).toHaveBeenCalledOnce();
  });

  it('validates bounded install inputs before delegating', async () => {
    await expect(getHandler(IPC.TOOLS.INSTALL_OPERATION)(EVT, 'cool', 'acme/tools'))
      .resolves.toEqual({ status: 'completed', action: 'install' });
    expect(tools.installForOperator).toHaveBeenCalledWith('cool', 'acme/tools');

    await expect(getHandler(IPC.TOOLS.INSTALL_OPERATION)(EVT, '', 'acme/tools')).rejects.toThrow(TypeError);
    expect(tools.installForOperator).toHaveBeenCalledTimes(1);
  });
});

function getHandler(channel: string): InvokeHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((item) => item[0] === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as InvokeHandler;
}
