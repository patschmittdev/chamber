import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppearanceBridge, ElectronAPI } from '@chamber/shared/electron-types';
import type { AppearanceSnapshot } from '@chamber/shared/appearance-types';

const initialSnapshot: AppearanceSnapshot = {
  themePreference: 'light',
  resolvedTheme: 'light',
  fontScale: 'large',
  density: 'compact',
};

const electronMocks = vi.hoisted(() => {
  const exposed = new Map<string, unknown>();
  return {
    exposed,
    contextBridge: {
      exposeInMainWorld: vi.fn((name: string, api: unknown) => {
        exposed.set(name, api);
      }),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      send: vi.fn(),
      sendSync: vi.fn((channel: string) => {
        if (channel === 'appearance:getInitialSnapshot') {
          return {
            themePreference: 'light',
            resolvedTheme: 'light',
            fontScale: 'large',
            density: 'compact',
          };
        }
        return false;
      }),
      on: vi.fn(),
      removeListener: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  contextBridge: electronMocks.contextBridge,
  ipcRenderer: electronMocks.ipcRenderer,
}));

describe('desktop preload appearance bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    electronMocks.exposed.clear();
    electronMocks.contextBridge.exposeInMainWorld.mockClear();
    electronMocks.ipcRenderer.invoke.mockClear();
    electronMocks.ipcRenderer.send.mockClear();
    electronMocks.ipcRenderer.sendSync.mockClear();
    electronMocks.ipcRenderer.on.mockClear();
    electronMocks.ipcRenderer.removeListener.mockClear();
  });

  it('exposes a cached sync initial snapshot and async appearance APIs', async () => {
    await import('./preload');

    const bridge = electronMocks.exposed.get('chamberAppearance') as AppearanceBridge;
    expect(bridge).toBeDefined();
    expect(electronMocks.ipcRenderer.sendSync).toHaveBeenCalledWith('appearance:getInitialSnapshot');
    expect(bridge.getInitialSnapshot()).toEqual(initialSnapshot);

    await bridge.get();
    expect(electronMocks.ipcRenderer.invoke).toHaveBeenCalledWith('appearance:get');

    await bridge.set({ density: 'comfortable' });
    expect(electronMocks.ipcRenderer.invoke).toHaveBeenCalledWith('appearance:set', { density: 'comfortable' });
  });

  it('subscribes to appearance change events through the typed listener helper', async () => {
    await import('./preload');
    const bridge = electronMocks.exposed.get('chamberAppearance') as AppearanceBridge;
    const callback = vi.fn();

    const unsubscribe = bridge.onChanged(callback);
    const registered = electronMocks.ipcRenderer.on.mock.calls.find(([channel]) => channel === 'appearance:changed');
    expect(registered).toBeDefined();

    const handler = registered?.[1] as (event: unknown, snapshot: AppearanceSnapshot) => void;
    handler({}, initialSnapshot);
    expect(callback).toHaveBeenCalledWith(initialSnapshot);

    unsubscribe();
    expect(electronMocks.ipcRenderer.removeListener).toHaveBeenCalledWith('appearance:changed', handler);
  });

  it('exposes the read-only capability inventory bridge', async () => {
    await import('./preload');
    const api = electronMocks.exposed.get('electronAPI') as ElectronAPI;

    await api.capabilities.list({ mindId: 'lucy', availability: 'installed' });

    expect(electronMocks.ipcRenderer.invoke).toHaveBeenCalledWith('capabilities:list', {
      mindId: 'lucy',
      availability: 'installed',
    });
  });
});
