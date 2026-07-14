import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MCPServerConfig } from '@github/copilot-sdk';
import { MindTrustService, computeMcpServerFingerprint } from './MindTrustService';
import { MindTrustLedger, TRUST_LEDGER_FILENAME } from './MindTrustLedger';
import type { MindTrustRecord } from './types';

let tmpDir: string;
let mindPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-trust-'));
  mindPath = path.join(tmpDir, 'my-mind');
  fs.mkdirSync(mindPath, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function ledgerPath(userData: string): string {
  return path.join(userData, TRUST_LEDGER_FILENAME);
}

function noMcpServers(): Record<string, MCPServerConfig> {
  return {};
}

describe('MindTrustService', () => {
  describe('ledger persistence', () => {
    it('persists a pending record on first registerMindLoad', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');

      const ledger = new MindTrustLedger(tmpDir).read();
      expect(ledger.records).toHaveLength(1);
      expect(ledger.records[0]?.mindId).toBe('mind-1');
      expect(ledger.records[0]?.status).toBe('pending');
      expect(ledger.records[0]?.resolvedPath).toBe(mindPath);
    });

    it('writes atomically via .tmp rename', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');

      // .tmp file should be gone after write
      expect(fs.existsSync(`${ledgerPath(tmpDir)}.tmp`)).toBe(false);
      // Actual ledger file should exist
      expect(fs.existsSync(ledgerPath(tmpDir))).toBe(true);
    });

    it('reads an existing ledger on construction', () => {
      // Write a ledger by registering a mind
      const svc1 = new MindTrustService(tmpDir, noMcpServers);
      svc1.registerMindLoad('mind-1', mindPath, 'local');
      svc1.grantTrust('mind-1');

      // Second instance reads from disk
      const svc2 = new MindTrustService(tmpDir, noMcpServers);
      const status = svc2.getTrustStatus('mind-1');
      expect(status?.status).toBe('trusted');
    });

    it('fails closed on malformed JSON ledger', () => {
      fs.writeFileSync(ledgerPath(tmpDir), '{not json}', 'utf-8');
      const svc = new MindTrustService(tmpDir, noMcpServers);
      // Mind should default to pending (not found = not trusted)
      expect(svc.isMindTrustedForExecution('mind-1', mindPath)).toBe(false);
    });

    it('fails closed on valid JSON with wrong schema', () => {
      fs.writeFileSync(ledgerPath(tmpDir), JSON.stringify({ version: 1, records: [{ bad: 'data' }] }), 'utf-8');
      const svc = new MindTrustService(tmpDir, noMcpServers);
      expect(svc.isMindTrustedForExecution('mind-1', mindPath)).toBe(false);
    });
  });

  describe('trust states', () => {
    it('new mind starts as pending', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');
      expect(svc.getTrustStatus('mind-1')?.status).toBe('pending');
    });

    it('grantTrust transitions pending to trusted', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.grantTrust('mind-1');
      expect(svc.getTrustStatus('mind-1')?.status).toBe('trusted');
    });

    it('revokeTrust transitions trusted to revoked', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.grantTrust('mind-1');
      svc.revokeTrust('mind-1');
      expect(svc.getTrustStatus('mind-1')?.status).toBe('revoked');
    });

    it('grantTrust is idempotent when already trusted', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.grantTrust('mind-1');
      const statusA = svc.getTrustStatus('mind-1');
      svc.grantTrust('mind-1');
      const statusB = svc.getTrustStatus('mind-1');
      expect(statusA?.status).toBe(statusB?.status);
    });

    it('revokeTrust is idempotent when already revoked', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.revokeTrust('mind-1'); // no-op — not yet registered as revoked
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.grantTrust('mind-1');
      svc.revokeTrust('mind-1');
      svc.revokeTrust('mind-1');
      expect(svc.getTrustStatus('mind-1')?.status).toBe('revoked');
    });

    it('getTrustStatus returns null for unknown mindId', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      expect(svc.getTrustStatus('unknown')).toBeNull();
    });

    it('isMindTrustedForExecution returns false for pending mind', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');
      expect(svc.isMindTrustedForExecution('mind-1', mindPath)).toBe(false);
    });

    it('isMindTrustedForExecution returns true for trusted mind with matching path', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.grantTrust('mind-1');
      expect(svc.isMindTrustedForExecution('mind-1', mindPath)).toBe(true);
    });

    it('isMindTrustedForExecution returns false for revoked mind', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.grantTrust('mind-1');
      svc.revokeTrust('mind-1');
      expect(svc.isMindTrustedForExecution('mind-1', mindPath)).toBe(false);
    });
  });

  describe('path mismatch', () => {
    it('treats a mind as pending when the loaded path differs from the stored path', () => {
      const altPath = path.join(tmpDir, 'alt-mind');
      fs.mkdirSync(altPath, { recursive: true });

      // Register and grant at original path
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.grantTrust('mind-1');

      // Re-register at different path (same mindId)
      svc.registerMindLoad('mind-1', altPath, 'local');

      // Path mismatch: should not be trusted
      expect(svc.isMindTrustedForExecution('mind-1', altPath)).toBe(false);
      expect(svc.getTrustStatus('mind-1')?.status).toBe('pending');
    });

    it('isMindTrustedForExecution returns false when provided path differs from ledger path', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.grantTrust('mind-1');

      const wrongPath = path.join(tmpDir, 'other-dir');
      expect(svc.isMindTrustedForExecution('mind-1', wrongPath)).toBe(false);
    });
  });

  describe('MCP server fingerprinting', () => {
    const serverA: MCPServerConfig = {
      type: 'stdio',
      command: 'node',
      args: ['./server.js'],
      tools: ['*'],
    } as MCPServerConfig;

    const serverB: MCPServerConfig = {
      type: 'stdio',
      command: 'node',
      args: ['./different-server.js'],
      tools: ['*'],
    } as MCPServerConfig;

    it('approved unchanged MCP server is included in getApprovedMcpServers', () => {
      const svc = new MindTrustService(tmpDir, () => ({ serverA }));
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.grantTrust('mind-1');

      const approved = svc.getApprovedMcpServers('mind-1', mindPath, { serverA });
      expect(Object.keys(approved)).toEqual(['serverA']);
    });

    it('changing any field in a server entry invalidates that approval', () => {
      const svc = new MindTrustService(tmpDir, () => ({ serverA }));
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.grantTrust('mind-1');

      // Swap in a modified server under the same name
      const modified: MCPServerConfig = { ...serverA, args: ['./changed.js'] } as MCPServerConfig;
      const approved = svc.getApprovedMcpServers('mind-1', mindPath, { serverA: modified });
      expect(approved).toEqual({});
    });

    it('unapproved server (added after grant) is excluded', () => {
      const svc = new MindTrustService(tmpDir, () => ({ serverA }));
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.grantTrust('mind-1');

      // serverB was not present at grant time
      const approved = svc.getApprovedMcpServers('mind-1', mindPath, { serverA, serverB });
      expect(Object.keys(approved)).toEqual(['serverA']);
      expect(Object.keys(approved)).not.toContain('serverB');
    });

    it('revocation clears all MCP fingerprints', () => {
      const svc = new MindTrustService(tmpDir, () => ({ serverA }));
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.grantTrust('mind-1');
      svc.revokeTrust('mind-1');

      const record = new MindTrustLedger(tmpDir).read().records[0] as MindTrustRecord;
      expect(record.approvedMcpFingerprints).toEqual([]);
    });

    it('getApprovedMcpServers returns empty object for pending mind', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');
      const approved = svc.getApprovedMcpServers('mind-1', mindPath, { serverA });
      expect(approved).toEqual({});
    });

    it('getTrustStatus reports correct approvedMcpCount', () => {
      const svc = new MindTrustService(tmpDir, () => ({ serverA, serverB }));
      svc.registerMindLoad('mind-1', mindPath, 'local');
      svc.grantTrust('mind-1');

      const status = svc.getTrustStatus('mind-1');
      expect(status?.approvedMcpCount).toBe(2);
    });
  });

  describe('computeMcpServerFingerprint', () => {
    it('produces the same fingerprint for identical entries', () => {
      const config: MCPServerConfig = { type: 'stdio', command: 'node', args: ['a.js'], tools: ['*'] } as MCPServerConfig;
      expect(computeMcpServerFingerprint('srv', config)).toBe(computeMcpServerFingerprint('srv', config));
    });

    it('produces different fingerprints for different names', () => {
      const config: MCPServerConfig = { type: 'stdio', command: 'node', args: ['a.js'], tools: ['*'] } as MCPServerConfig;
      expect(computeMcpServerFingerprint('srvA', config)).not.toBe(computeMcpServerFingerprint('srvB', config));
    });

    it('produces different fingerprints when any field changes', () => {
      const configA: MCPServerConfig = { type: 'stdio', command: 'node', args: ['a.js'], tools: ['*'] } as MCPServerConfig;
      const configB: MCPServerConfig = { type: 'stdio', command: 'python', args: ['a.js'], tools: ['*'] } as MCPServerConfig;
      expect(computeMcpServerFingerprint('srv', configA)).not.toBe(computeMcpServerFingerprint('srv', configB));
    });

    it('is stable regardless of key insertion order', () => {
      const configA = { type: 'stdio', command: 'node', tools: ['*'], args: ['a.js'] } as unknown as MCPServerConfig;
      const configB = { args: ['a.js'], command: 'node', tools: ['*'], type: 'stdio' } as unknown as MCPServerConfig;
      expect(computeMcpServerFingerprint('srv', configA)).toBe(computeMcpServerFingerprint('srv', configB));
    });
  });

  describe('migration', () => {
    it('grants trusted status to existing reachable minds', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.runMigration([{ id: 'mind-1', path: mindPath }], noMcpServers);

      expect(svc.getTrustStatus('mind-1')?.status).toBe('trusted');
    });

    it('creates pending record for unreachable mind path', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      const nonExistentPath = path.join(tmpDir, 'does-not-exist');
      svc.runMigration([{ id: 'mind-1', path: nonExistentPath }], noMcpServers);

      expect(svc.getTrustStatus('mind-1')?.status).toBe('pending');
    });

    it('is idempotent: running twice produces the same result', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.runMigration([{ id: 'mind-1', path: mindPath }], noMcpServers);
      const statusAfterFirst = svc.getTrustStatus('mind-1');

      svc.runMigration([{ id: 'mind-1', path: mindPath }], noMcpServers);
      const statusAfterSecond = svc.getTrustStatus('mind-1');

      expect(statusAfterFirst?.status).toBe(statusAfterSecond?.status);
    });

    it('does not overwrite an existing pending record during migration', () => {
      // Mind is already in the ledger as pending (e.g., from a previous load)
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'imported');
      expect(svc.getTrustStatus('mind-1')?.status).toBe('pending');

      // Migration should not upgrade a pending to trusted
      svc.runMigration([{ id: 'mind-1', path: mindPath }], noMcpServers);
      expect(svc.getTrustStatus('mind-1')?.status).toBe('pending');
    });

    it('pre-approves current MCP fingerprints for migrated minds', () => {
      const serverA: MCPServerConfig = {
        type: 'stdio',
        command: 'node',
        args: ['./srv.js'],
        tools: ['*'],
      } as MCPServerConfig;

      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.runMigration([{ id: 'mind-1', path: mindPath }], () => ({ serverA }));

      // After migration, the server is approved
      const approved = svc.getApprovedMcpServers('mind-1', mindPath, { serverA });
      expect(Object.keys(approved)).toEqual(['serverA']);
    });

    it('persists migration results to disk', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.runMigration([{ id: 'mind-1', path: mindPath }], noMcpServers);

      const svc2 = new MindTrustService(tmpDir, noMcpServers);
      expect(svc2.getTrustStatus('mind-1')?.status).toBe('trusted');
    });
  });

  describe('full lifecycle', () => {
    it('load -> pending -> grant -> trusted -> revoke -> revoked', () => {
      const svc = new MindTrustService(tmpDir, noMcpServers);
      svc.registerMindLoad('mind-1', mindPath, 'local');
      expect(svc.getTrustStatus('mind-1')?.status).toBe('pending');

      svc.grantTrust('mind-1');
      expect(svc.isMindTrustedForExecution('mind-1', mindPath)).toBe(true);

      svc.revokeTrust('mind-1');
      expect(svc.isMindTrustedForExecution('mind-1', mindPath)).toBe(false);
      expect(svc.getTrustStatus('mind-1')?.status).toBe('revoked');
    });

    it('persists across service instances', () => {
      const svc1 = new MindTrustService(tmpDir, noMcpServers);
      svc1.registerMindLoad('mind-1', mindPath, 'local');
      svc1.grantTrust('mind-1');

      // New process reading the same userData
      const svc2 = new MindTrustService(tmpDir, noMcpServers);
      expect(svc2.isMindTrustedForExecution('mind-1', mindPath)).toBe(true);
    });
  });
});
