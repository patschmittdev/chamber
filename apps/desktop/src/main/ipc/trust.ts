import { ipcMain } from 'electron';
import { IPC } from '@chamber/shared';
import type { IMindTrustService, CronService } from '@chamber/services';

/**
 * Thin IPC adapter for the mind trust boundary. Exposes only renderer-safe
 * projections of trust state. Never sends raw MCP configuration, commands,
 * arguments, environment variables, paths, or credentials to the renderer.
 */
export function setupTrustIPC(
  trustService: IMindTrustService,
  cronService: CronService,
): void {
  ipcMain.handle(IPC.MIND_TRUST.STATUS, (_event, mindId: string) => {
    return trustService.getTrustStatus(mindId) ?? null;
  });

  ipcMain.handle(IPC.MIND_TRUST.GRANT, (_event, mindId: string) => {
    trustService.grantTrust(mindId);
  });

  ipcMain.handle(IPC.MIND_TRUST.REVOKE, (_event, mindId: string) => {
    trustService.revokeTrust(mindId);
    cronService.cancelJobsForMind(mindId);
  });
}
