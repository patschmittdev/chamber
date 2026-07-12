import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '@chamber/shared';
import type { CanvasService, LensPreferencesService, MindManager, ViewDiscovery } from '@chamber/services';
import { setupLensIPC } from './lens';

const EVT = {} as IpcMainInvokeEvent;
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function createDiscovery(): ViewDiscovery {
  return {
    getViews: vi.fn().mockReturnValue([]),
    getViewData: vi.fn().mockReturnValue(null),
    refreshView: vi.fn().mockResolvedValue(null),
    sendAction: vi.fn().mockResolvedValue(null),
    getViewSourcePath: vi.fn().mockReturnValue(null),
  } as unknown as ViewDiscovery;
}

function createMindManager() {
  return {
    getActiveMindId: vi.fn().mockReturnValue('mind-a'),
    getMind: vi.fn((mindId: string) => (
      mindId === 'mind-a'
        ? { mindId, mindPath: 'C:\\minds\\a' }
        : undefined
    )),
    on: vi.fn(),
  } as unknown as MindManager & {
    getActiveMindId: ReturnType<typeof vi.fn>;
    getMind: ReturnType<typeof vi.fn>;
  };
}

function createCanvasService(): CanvasService {
  return {
    showLensCanvas: vi.fn().mockResolvedValue(null),
  } as unknown as CanvasService;
}

function createPreferences(): LensPreferencesService {
  return {
    getDisabledViewIds: vi.fn().mockReturnValue(['briefing']),
    setViewEnabled: vi.fn((mindId: string, viewId: string, enabled: boolean) => ({ mindId, viewId, enabled })),
  } as unknown as LensPreferencesService;
}

describe('setupLensIPC', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
  });

  it('registers Lens visibility handlers', () => {
    setupLensIPC(createDiscovery(), createMindManager(), createCanvasService(), createPreferences());

    const channels = vi.mocked(ipcMain.handle).mock.calls.map((call) => call[0]);
    expect(channels).toContain(IPC.LENS.GET_DISABLED_VIEW_IDS);
    expect(channels).toContain(IPC.LENS.SET_VIEW_ENABLED);
  });

  it('returns disabled view ids for the resolved active mind', async () => {
    const preferences = createPreferences();
    setupLensIPC(createDiscovery(), createMindManager(), createCanvasService(), preferences);

    await expect(getHandler(IPC.LENS.GET_DISABLED_VIEW_IDS)(EVT, undefined)).resolves.toEqual(['briefing']);
    expect(preferences.getDisabledViewIds).toHaveBeenCalledWith('mind-a');
  });

  it('persists view visibility and broadcasts the change', async () => {
    const preferences = createPreferences();
    const send = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([{ webContents: { send } }] as never);
    setupLensIPC(createDiscovery(), createMindManager(), createCanvasService(), preferences);

    await expect(getHandler(IPC.LENS.SET_VIEW_ENABLED)(EVT, 'briefing', false, 'mind-a')).resolves.toEqual({
      mindId: 'mind-a',
      viewId: 'briefing',
      enabled: false,
    });

    expect(preferences.setViewEnabled).toHaveBeenCalledWith('mind-a', 'briefing', false);
    expect(send).toHaveBeenCalledWith(IPC.LENS.VISIBILITY_CHANGED, {
      mindId: 'mind-a',
      viewId: 'briefing',
      enabled: false,
    });
  });

  it('rejects invalid toggle payloads before persistence', async () => {
    const preferences = createPreferences();
    setupLensIPC(createDiscovery(), createMindManager(), createCanvasService(), preferences);

    await expect(getHandler(IPC.LENS.SET_VIEW_ENABLED)(EVT, 'briefing', 'nope', 'mind-a')).rejects.toThrow(TypeError);
    expect(preferences.setViewEnabled).not.toHaveBeenCalled();
  });

  it('rejects a non-string mind id on read channels', async () => {
    const preferences = createPreferences();
    setupLensIPC(createDiscovery(), createMindManager(), createCanvasService(), preferences);

    await expect(getHandler(IPC.LENS.GET_DISABLED_VIEW_IDS)(EVT, 42)).rejects.toThrow(/lens:getDisabledViewIds/);
    expect(preferences.getDisabledViewIds).not.toHaveBeenCalled();
  });
});

function getHandler(channel: string): InvokeHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((item) => item[0] === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as InvokeHandler;
}
