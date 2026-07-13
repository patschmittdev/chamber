import { ipcMain } from 'electron';
import type { MindMemoryService } from '@chamber/services';

const CHANNEL = 'mindMemory:read';

/**
 * Thin adapter exposing the read-only working-memory reader to the renderer.
 * The service owns confinement and bounding; this handler only marshals args.
 */
export function setupMindMemoryIPC(service: MindMemoryService): void {
  ipcMain.handle(CHANNEL, async (_event, mindId: unknown) => {
    if (typeof mindId !== 'string') {
      throw new TypeError(`${CHANNEL} requires a string mindId`);
    }
    return service.read(mindId);
  });
}
