import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import { IPC } from '@chamber/shared';
import {
  isDensity,
  isFontScale,
  isThemePreference,
  type AppearancePreferences,
  type AppearanceSnapshot,
  type Density,
  type FontScale,
  type ResolvedTheme,
  type ThemePreference,
} from '@chamber/shared/appearance-types';
import type { AppearanceService } from '../services/appearance';
import { applyTitleBarTheme, windowBackgroundColorFor } from '../titleBarTheme';

const ALLOWED_SET_KEYS = new Set(['themePreference', 'fontScale', 'density']);

export function setupAppearanceIPC(appearanceService: AppearanceService): void {
  ipcMain.on(IPC.APPEARANCE.GET_INITIAL_SNAPSHOT, (event: IpcMainEvent) => {
    event.returnValue = appearanceService.getSnapshot();
  });

  ipcMain.handle(IPC.APPEARANCE.GET, () => appearanceService.getSnapshot());
  ipcMain.handle(IPC.APPEARANCE.SET, (_event, payload: unknown) => {
    const snapshot = appearanceService.setPreferences(parseAppearancePatch(payload));
    return snapshot;
  });

  appearanceService.subscribe((snapshot) => {
    applyAppearanceToAllWindows(snapshot.resolvedTheme);
    broadcastAppearance(snapshot);
  });
}

function parseAppearancePatch(payload: unknown): Partial<AppearancePreferences> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('appearance:set: invalid payload');
  }

  const record = payload as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_SET_KEYS.has(key)) {
      throw new Error(`appearance:set: unknown preference "${key}"`);
    }
  }

  const patch: {
    themePreference?: ThemePreference;
    fontScale?: FontScale;
    density?: Density;
  } = {};
  if ('themePreference' in record) {
    if (!isThemePreference(record.themePreference)) throw new Error('appearance:set: invalid themePreference');
    patch.themePreference = record.themePreference;
  }
  if ('fontScale' in record) {
    if (!isFontScale(record.fontScale)) throw new Error('appearance:set: invalid fontScale');
    patch.fontScale = record.fontScale;
  }
  if ('density' in record) {
    if (!isDensity(record.density)) throw new Error('appearance:set: invalid density');
    patch.density = record.density;
  }
  if (Object.keys(patch).length === 0) throw new Error('appearance:set: no preferences provided');
  return patch;
}

function broadcastAppearance(snapshot: AppearanceSnapshot): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.APPEARANCE.CHANGED, snapshot);
  }
}

function applyAppearanceToAllWindows(theme: ResolvedTheme): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    applyTitleBarTheme(win, theme);
    win.setBackgroundColor(windowBackgroundColorFor(theme));
  }
}
