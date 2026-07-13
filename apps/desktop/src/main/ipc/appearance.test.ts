import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
}));

import { BrowserWindow, ipcMain } from 'electron';
import { IPC } from '@chamber/shared';
import { setupAppearanceIPC } from './appearance';
import type { AppearanceService } from '../services/appearance';
import type { AppearanceSnapshot } from '@chamber/shared/appearance-types';

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;
type IpcSyncHandler = (event: { returnValue?: unknown }) => void;

const darkSnapshot: AppearanceSnapshot = {
  themePreference: 'dark',
  resolvedTheme: 'dark',
  fontScale: 'medium',
  density: 'comfortable',
};

const lightSnapshot: AppearanceSnapshot = {
  themePreference: 'light',
  resolvedTheme: 'light',
  fontScale: 'large',
  density: 'compact',
};

describe('setupAppearanceIPC', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
    vi.mocked(ipcMain.on).mockClear();
    vi.mocked(BrowserWindow.getAllWindows).mockReset();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([]);
  });

  it('registers get, set, changed, and sync initial snapshot handlers', () => {
    setupAppearanceIPC(createService());

    expect(registeredHandleChannels()).toEqual(expect.arrayContaining([
      IPC.APPEARANCE.GET,
      IPC.APPEARANCE.SET,
    ]));
    expect(registeredOnChannels()).toContain(IPC.APPEARANCE.GET_INITIAL_SNAPSHOT);
  });

  it('returns the sync initial snapshot for pre-paint bootstrap', () => {
    setupAppearanceIPC(createService());
    const event: { returnValue?: unknown } = {};

    syncInvoke(event);

    expect(event.returnValue).toEqual(darkSnapshot);
  });

  it('validates set payloads and forwards a normalized patch', () => {
    const service = createService();
    setupAppearanceIPC(service);

    expect(invokeSet({ themePreference: 'light', fontScale: 'large', density: 'compact' })).toEqual(lightSnapshot);
    expect(service.setPreferences).toHaveBeenCalledWith({
      themePreference: 'light',
      fontScale: 'large',
      density: 'compact',
    });

    expect(() => invokeSet({ themePreference: 'neon' })).toThrow(/invalid themePreference/);
    expect(() => invokeSet({ density: 'cramped' })).toThrow(/invalid density/);
    expect(() => invokeSet({ unexpected: true })).toThrow(/unknown preference/);
    expect(() => invokeSet({})).toThrow(/no preferences provided/);
  });

  it('broadcasts changed snapshots and repaints native chrome', () => {
    const webContents = { send: vi.fn() };
    const setTitleBarOverlay = vi.fn();
    const setBackgroundColor = vi.fn();
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      {
        isDestroyed: () => false,
        webContents,
        setTitleBarOverlay,
        setBackgroundColor,
      },
    ] as never);
    const service = createService();
    setupAppearanceIPC(service);

    service.emit(lightSnapshot);

    expect(webContents.send).toHaveBeenCalledWith(IPC.APPEARANCE.CHANGED, lightSnapshot);
    expect(setTitleBarOverlay).toHaveBeenCalledWith(expect.objectContaining({
      color: '#ffffff',
      symbolColor: '#0a0a0a',
    }));
    expect(setBackgroundColor).toHaveBeenCalledWith('#ffffff');
  });

  it('still broadcasts to renderers when a window has no enabled title-bar overlay', () => {
    const webContents = { send: vi.fn() };
    const setBackgroundColor = vi.fn();
    const setTitleBarOverlay = vi.fn(() => {
      throw new TypeError('Titlebar overlay is not enabled');
    });
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      {
        isDestroyed: () => false,
        webContents,
        setTitleBarOverlay,
        setBackgroundColor,
      },
    ] as never);
    const service = createService();
    setupAppearanceIPC(service);

    expect(() => service.emit(lightSnapshot)).not.toThrow();
    expect(webContents.send).toHaveBeenCalledWith(IPC.APPEARANCE.CHANGED, lightSnapshot);
    expect(setBackgroundColor).toHaveBeenCalledWith('#ffffff');
  });
});

function createService(): AppearanceService & { emit: (snapshot: AppearanceSnapshot) => void } {
  let listener: ((snapshot: AppearanceSnapshot) => void) | null = null;
  return {
    getSnapshot: vi.fn(() => darkSnapshot),
    setPreferences: vi.fn(() => lightSnapshot),
    subscribe: vi.fn((next) => {
      listener = next;
      return () => {
        listener = null;
      };
    }),
    emit: (snapshot: AppearanceSnapshot) => listener?.(snapshot),
  } as unknown as AppearanceService & { emit: (snapshot: AppearanceSnapshot) => void };
}

function registeredHandleChannels(): string[] {
  return vi.mocked(ipcMain.handle).mock.calls.map(([channel]) => channel);
}

function registeredOnChannels(): string[] {
  return vi.mocked(ipcMain.on).mock.calls.map(([channel]) => channel);
}

function invokeSet(payload: unknown): unknown {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === IPC.APPEARANCE.SET);
  if (!call) throw new Error('appearance:set handler not registered');
  return (call[1] as IpcHandler)({}, payload);
}

function syncInvoke(event: { returnValue?: unknown }): void {
  const call = vi.mocked(ipcMain.on).mock.calls.find(([channel]) => channel === IPC.APPEARANCE.GET_INITIAL_SNAPSHOT);
  if (!call) throw new Error('appearance:getInitialSnapshot handler not registered');
  (call[1] as IpcSyncHandler)(event);
}
