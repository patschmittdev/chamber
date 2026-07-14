import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '@chamber/shared';
import { setupCapabilitiesIPC } from './capabilities';

const EVT = {} as IpcMainInvokeEvent;
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

describe('Capabilities IPC', () => {
  const getMindPath = vi.fn<(mindId: string) => string | undefined>();
  const list = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getMindPath.mockReturnValue(undefined);
    list.mockResolvedValue({ items: [], sources: [] });
    setupCapabilitiesIPC({ getMindPath }, { list });
  });

  it('lists global capabilities without resolving a mind path', async () => {
    await expect(getHandler(IPC.CAPABILITIES.LIST)(EVT, undefined)).resolves.toEqual({ items: [], sources: [] });
    expect(list).toHaveBeenCalledWith({}, undefined);
  });

  it('resolves an explicit mind id through the trusted mind provider', async () => {
    getMindPath.mockReturnValue('C:\\minds\\lucy');

    await getHandler(IPC.CAPABILITIES.LIST)(EVT, { mindId: 'lucy', availability: 'installed' });

    expect(getMindPath).toHaveBeenCalledWith('lucy');
    expect(list).toHaveBeenCalledWith({ mindId: 'lucy', availability: 'installed' }, 'C:\\minds\\lucy');
  });

  it('rejects malformed queries before resolving a mind', async () => {
    await expect(getHandler(IPC.CAPABILITIES.LIST)(EVT, { availability: 'everything' })).rejects.toThrow(TypeError);
    expect(getMindPath).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('rejects an unknown explicit mind', async () => {
    await expect(getHandler(IPC.CAPABILITIES.LIST)(EVT, { mindId: 'ghost' })).rejects.toThrow('Mind ghost not found');
    expect(list).not.toHaveBeenCalled();
  });
});

function getHandler(channel: string): InvokeHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((item) => item[0] === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as InvokeHandler;
}
