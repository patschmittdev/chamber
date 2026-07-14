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
  ipcMain.handle(IPC.MIND_TRUST.STATUS, (_event, mindId: unknown) => {
    if (typeof mindId !== 'string' || mindId.length === 0) return null;
    return trustService.getTrustStatus(mindId) ?? null;
  });

  ipcMain.handle(IPC.MIND_TRUST.GRANT, (_event, mindId: unknown) => {
    if (typeof mindId !== 'string' || mindId.length === 0) return;
    trustService.grantTrust(mindId);
  });

  ipcMain.handle(IPC.MIND_TRUST.REVOKE, (_event, mindId: unknown) => {
    if (typeof mindId !== 'string' || mindId.length === 0) return;
    trustService.revokeTrust(mindId);
    cronService.cancelJobsForMind(mindId);
    // NOTE: This does not disconnect live SDK sessions — MCP server connections
    // established before revocation remain active until the mind is unloaded or
    // its session is recreated. Severing live sessions on revocation requires
    // MindManager cooperation and is deferred to Stage 2 of this remediation.
  });
}
