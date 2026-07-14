import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('@chamber/shared', () => ({
  IPC: {
    MIND_TRUST: {
      STATUS: 'mind:trust:status',
      GRANT: 'mind:trust:grant',
      REVOKE: 'mind:trust:revoke',
    },
  },
}));

import { ipcMain } from 'electron';
import { IPC } from '@chamber/shared';
import type { IMindTrustService, CronService } from '@chamber/services';
import { setupTrustIPC } from './trust';

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

function handler(channel: string): IpcHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel);
  if (!call) throw new Error(`handler for "${channel}" was not registered`);
  return call[1] as IpcHandler;
}

function makeTrustService(): IMindTrustService {
  return {
    getTrustStatus: vi.fn(() => null),
    grantTrust: vi.fn(),
    revokeTrust: vi.fn(),
    isMindTrustedForExecution: vi.fn(() => false),
    getApprovedMcpServers: vi.fn(() => ({})),
    registerMindLoad: vi.fn(),
    runMigration: vi.fn(),
  };
}

function makeCronService(): Pick<CronService, 'cancelJobsForMind'> {
  return { cancelJobsForMind: vi.fn() };
}

describe('setupTrustIPC', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
  });

  it('registers handlers for status, grant, and revoke channels', () => {
    setupTrustIPC(makeTrustService(), makeCronService() as CronService);
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch);
    expect(channels).toContain(IPC.MIND_TRUST.STATUS);
    expect(channels).toContain(IPC.MIND_TRUST.GRANT);
    expect(channels).toContain(IPC.MIND_TRUST.REVOKE);
  });

  it('revoke calls trustService.revokeTrust with the mindId', async () => {
    const trust = makeTrustService();
    setupTrustIPC(trust, makeCronService() as CronService);
    await handler(IPC.MIND_TRUST.REVOKE)({}, 'mind-abc');
    expect(trust.revokeTrust).toHaveBeenCalledWith('mind-abc');
  });

  it('revoke calls cronService.cancelJobsForMind with the mindId', async () => {
    const cron = makeCronService();
    setupTrustIPC(makeTrustService(), cron as CronService);
    await handler(IPC.MIND_TRUST.REVOKE)({}, 'mind-xyz');
    expect(cron.cancelJobsForMind).toHaveBeenCalledWith('mind-xyz');
  });

  it('revoke calls the onRevoke callback with the mindId', async () => {
    const onRevoke = vi.fn<(mindId: string) => Promise<void>>();
    onRevoke.mockResolvedValue(undefined);
    setupTrustIPC(makeTrustService(), makeCronService() as CronService, onRevoke);
    await handler(IPC.MIND_TRUST.REVOKE)({}, 'mind-123');
    expect(onRevoke).toHaveBeenCalledWith('mind-123');
  });

  it('revoke does not call onRevoke when mindId is an empty string', async () => {
    const onRevoke = vi.fn<(mindId: string) => Promise<void>>();
    onRevoke.mockResolvedValue(undefined);
    setupTrustIPC(makeTrustService(), makeCronService() as CronService, onRevoke);
    await handler(IPC.MIND_TRUST.REVOKE)({}, '');
    expect(onRevoke).not.toHaveBeenCalled();
  });

  it('grant does not call onRevoke', async () => {
    const onRevoke = vi.fn<(mindId: string) => Promise<void>>();
    onRevoke.mockResolvedValue(undefined);
    setupTrustIPC(makeTrustService(), makeCronService() as CronService, onRevoke);
    await handler(IPC.MIND_TRUST.GRANT)({}, 'mind-abc');
    expect(onRevoke).not.toHaveBeenCalled();
  });

  it('status does not call onRevoke', async () => {
    const onRevoke = vi.fn<(mindId: string) => Promise<void>>();
    onRevoke.mockResolvedValue(undefined);
    setupTrustIPC(makeTrustService(), makeCronService() as CronService, onRevoke);
    await handler(IPC.MIND_TRUST.STATUS)({}, 'mind-abc');
    expect(onRevoke).not.toHaveBeenCalled();
  });
});
