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
  onRevoke?: (mindId: string) => Promise<void>,
): void {
  ipcMain.handle(IPC.MIND_TRUST.STATUS, (_event, mindId: unknown) => {
    if (typeof mindId !== 'string' || mindId.length === 0) return null;
    return trustService.getTrustStatus(mindId) ?? null;
  });

  ipcMain.handle(IPC.MIND_TRUST.GRANT, (_event, mindId: unknown) => {
    if (typeof mindId !== 'string' || mindId.length === 0) return;
    trustService.grantTrust(mindId);
  });

  ipcMain.handle(IPC.MIND_TRUST.REVOKE, async (_event, mindId: unknown) => {
    if (typeof mindId !== 'string' || mindId.length === 0) return;
    trustService.revokeTrust(mindId);
    cronService.cancelJobsForMind(mindId);
    await onRevoke?.(mindId);
  });
}
