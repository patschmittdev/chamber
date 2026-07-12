import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}));

import { BrowserWindow, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '@chamber/shared';
import type { OperatorActivitySnapshot } from '@chamber/shared/operator-activity-types';
import { createEmptyOperatorActivitySnapshot } from '@chamber/services';
import { setupOperatorActivityIPC } from './operatorActivity';

const EVT = {} as IpcMainInvokeEvent;
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function getHandler(channel: string): InvokeHandler {
  const calls = vi.mocked(ipcMain.handle).mock.calls;
  const match = calls.find((call) => call[0] === channel);
  if (!match) throw new Error(`No handler registered for ${channel}`);
  return match[1] as InvokeHandler;
}

function createService(snapshot: OperatorActivitySnapshot) {
  let listener: ((snapshot: OperatorActivitySnapshot) => void) | null = null;
  return {
    getSnapshot: vi.fn(async () => snapshot),
    subscribeChanged: vi.fn((callback: (snapshot: OperatorActivitySnapshot) => void) => {
      listener = callback;
      return vi.fn();
    }),
    emit(snapshotToEmit: OperatorActivitySnapshot): void {
      listener?.(snapshotToEmit);
    },
  };
}

describe('operator activity IPC', () => {
  const snapshot = createEmptyOperatorActivitySnapshot('2026-07-12T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
  });

  it('registers getSnapshot and forwards to the service', async () => {
    const service = createService(snapshot);
    setupOperatorActivityIPC(service);

    await expect(getHandler(IPC.OPERATOR_ACTIVITY.GET_SNAPSHOT)(EVT)).resolves.toEqual(snapshot);
    expect(service.getSnapshot).toHaveBeenCalledOnce();
  });

  it('rejects unexpected getSnapshot args before invoking the service', async () => {
    const service = createService(snapshot);
    setupOperatorActivityIPC(service);

    await expect(getHandler(IPC.OPERATOR_ACTIVITY.GET_SNAPSHOT)(EVT, 'extra')).rejects.toThrow(/operatorActivity:getSnapshot/);
    expect(service.getSnapshot).not.toHaveBeenCalled();
  });

  it('broadcasts changed snapshots to live windows', () => {
    const service = createService(snapshot);
    const liveSend = vi.fn();
    const destroyedSend = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: { send: liveSend },
      },
      {
        isDestroyed: () => true,
        webContents: { send: destroyedSend },
      },
    ] as never);
    setupOperatorActivityIPC(service);

    service.emit(snapshot);

    expect(liveSend).toHaveBeenCalledWith(IPC.OPERATOR_ACTIVITY.CHANGED, snapshot);
    expect(destroyedSend).not.toHaveBeenCalled();
  });
});
