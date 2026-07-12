// Lens IPC handlers — thin adapters for ViewDiscovery
import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import { IPC, parseIpcArgs } from '@chamber/shared';
import type { CanvasService, LensPreferencesService, MindManager, ViewDiscovery } from '@chamber/services';
import type { LensViewManifest } from '@chamber/shared/types';

const optionalMindIdSchema = z.string().trim().min(1, 'must be a non-empty string').optional();
const viewIdSchema = z.string().trim().min(1, 'must be a non-empty string');
const setViewEnabledSchema = z.object({
  viewId: viewIdSchema,
  enabled: z.boolean(),
  mindId: optionalMindIdSchema,
}).strict();

export function setupLensIPC(
  viewDiscovery: ViewDiscovery,
  mindManager: MindManager,
  canvasService: CanvasService,
  lensPreferences: LensPreferencesService,
): void {
  const resolveMindId = (mindId?: string): string | undefined =>
    mindId ?? mindManager.getActiveMindId() ?? undefined;

  const resolveMindPath = (mindId?: string): string | undefined => {
    const id = mindId ?? mindManager.getActiveMindId() ?? undefined;
    return id ? mindManager.getMind(id)?.mindPath : undefined;
  };

  const resolveMind = (mindId?: string) => {
    const id = mindId ?? mindManager.getActiveMindId() ?? undefined;
    return id ? mindManager.getMind(id) : undefined;
  };

  ipcMain.handle(IPC.LENS.GET_VIEWS, async (_event, rawMindId?: unknown) => {
    const mindId = parseIpcArgs(IPC.LENS.GET_VIEWS, optionalMindIdSchema, rawMindId);
    return viewDiscovery.getViews(resolveMindPath(mindId));
  });

  ipcMain.handle(IPC.LENS.GET_VIEW_DATA, async (_event, viewId: string, mindId?: string) => {
    return viewDiscovery.getViewData(viewId, resolveMindPath(mindId));
  });

  ipcMain.handle(IPC.LENS.REFRESH_VIEW, async (_event, viewId: string, mindId?: string) => {
    const mindPath = resolveMindPath(mindId);
    if (!mindPath) return null;
    return viewDiscovery.refreshView(viewId, mindPath);
  });

  ipcMain.handle(IPC.LENS.SEND_ACTION, async (_event, viewId: string, action: string, mindId?: string) => {
    const mindPath = resolveMindPath(mindId);
    if (!mindPath) return null;
    return viewDiscovery.sendAction(viewId, action, mindPath);
  });

  ipcMain.handle(IPC.LENS.GET_CANVAS_URL, async (_event, viewId: string, mindId?: string) => {
    const mind = resolveMind(mindId);
    if (!mind) return null;
    const sourcePath = viewDiscovery.getViewSourcePath(viewId, mind.mindPath);
    if (!sourcePath) return null;
    return canvasService.showLensCanvas(mind.mindId, mind.mindPath, viewId, sourcePath);
  });

  ipcMain.handle(IPC.LENS.GET_DISABLED_VIEW_IDS, async (_event, rawMindId?: unknown) => {
    const mindId = parseIpcArgs(IPC.LENS.GET_DISABLED_VIEW_IDS, optionalMindIdSchema, rawMindId);
    const id = resolveMindId(mindId);
    if (!id) return [];
    return lensPreferences.getDisabledViewIds(id);
  });

  ipcMain.handle(IPC.LENS.SET_VIEW_ENABLED, async (_event, rawViewId: unknown, rawEnabled: unknown, rawMindId?: unknown) => {
    const { viewId, enabled, mindId } = parseIpcArgs(IPC.LENS.SET_VIEW_ENABLED, setViewEnabledSchema, {
      viewId: rawViewId,
      enabled: rawEnabled,
      mindId: rawMindId,
    });
    const id = resolveMindId(mindId);
    if (!id) throw new Error('No mind selected to update Lens view visibility for');
    const visibility = lensPreferences.setViewEnabled(id, viewId, enabled);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.LENS.VISIBILITY_CHANGED, visibility);
    }
    return visibility;
  });

  // MindManager EventEmitter channel name (intentionally string, not IPC.*)
  // because this is an internal pub/sub channel within the main process.
  mindManager.on('lens:viewsChanged', (views: LensViewManifest[], mindId: string) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.LENS.VIEWS_CHANGED, views, mindId);
    }
  });
}
