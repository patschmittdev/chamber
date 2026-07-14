// MindTrustService — per-mind execution trust boundary.
//
// Owns the trust ledger. Called by CronService and MindManager before any
// workspace execution (scripts, MCP servers). Minds are trusted only after
// an explicit desktop-user grant. Existing locally-known minds receive a
// bounded migration grant on first upgrade.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MCPServerConfig } from '@github/copilot-sdk';
import type {
  IMindTrustService,
  MindSourceCategory,
  MindTrustRecord,
  MindTrustStatusResult,
} from './types';
import { MindTrustLedger } from './MindTrustLedger';
import { Logger } from '../logger';

export const TRUST_POLICY_VERSION = 1;

const log = Logger.create('MindTrustService');

export class MindTrustService implements IMindTrustService {
  private readonly ledger: MindTrustLedger;
  // In-memory map from mindId -> resolved path for minds loaded this session.
  private readonly loadedPaths = new Map<string, string>();
  // Cached ledger records (in-memory). The ledger is the source of truth.
  private records = new Map<string, MindTrustRecord>();

  constructor(
    userDataPath: string,
    private readonly readMcpServersForPath?: (mindPath: string) => Record<string, MCPServerConfig>,
  ) {
    this.ledger = new MindTrustLedger(userDataPath);
    this.loadRecords();
  }

  registerMindLoad(mindId: string, resolvedPath: string, source: MindSourceCategory): void {
    this.loadedPaths.set(mindId, resolvedPath);

    const existing = this.records.get(mindId);
    if (!existing) {
      // New mind — create a pending record.
      const record: MindTrustRecord = {
        mindId,
        resolvedPath,
        source,
        status: 'pending',
        grantedAt: null,
        revokedAt: null,
        policyVersion: TRUST_POLICY_VERSION,
        approvedMcpFingerprints: [],
        approvedCronFingerprints: [],
      };
      this.records.set(mindId, record);
      this.persist();
      return;
    }

    // Existing record: validate path. Path mismatch downgrades to pending
    // for this session (does not mutate the ledger — log only).
    if (!this.pathsMatch(existing.resolvedPath, resolvedPath)) {
      log.warn(
        `Mind ${mindId} loaded from path "${resolvedPath}" but ledger has "${existing.resolvedPath}". Treating as pending.`,
      );
      // Update to new path and reset to pending.
      const updated: MindTrustRecord = {
        ...existing,
        resolvedPath,
        status: 'pending',
        grantedAt: null,
        revokedAt: null,
        approvedMcpFingerprints: [],
        approvedCronFingerprints: [],
      };
      this.records.set(mindId, updated);
      this.persist();
    }
  }

  isMindTrustedForExecution(mindId: string, resolvedPath: string): boolean {
    const record = this.records.get(mindId);
    if (!record) return false;
    if (record.status !== 'trusted') return false;
    if (!this.pathsMatch(record.resolvedPath, resolvedPath)) return false;
    return true;
  }

  getApprovedMcpServers(
    mindId: string,
    resolvedPath: string,
    servers: Record<string, MCPServerConfig>,
  ): Record<string, MCPServerConfig> {
    if (!this.isMindTrustedForExecution(mindId, resolvedPath)) return {};

    const record = this.records.get(mindId);
    if (!record) return {};

    const approved: Record<string, MCPServerConfig> = {};
    for (const [name, config] of Object.entries(servers)) {
      const fingerprint = computeMcpServerFingerprint(name, config);
      if (record.approvedMcpFingerprints.includes(fingerprint)) {
        approved[name] = config;
      }
    }
    return approved;
  }

  grantTrust(mindId: string): void {
    const existing = this.records.get(mindId);
    if (existing?.status === 'trusted') return;

    const resolvedPath = this.loadedPaths.get(mindId);
    if (!resolvedPath) {
      log.warn(`Cannot grant trust for unregistered mind ${mindId}`);
      return;
    }

    // Compute MCP fingerprints from current workspace state.
    const mcpServers = this.readMcpServersForPath?.(resolvedPath) ?? {};
    const approvedMcpFingerprints = Object.entries(mcpServers).map(([name, config]) =>
      computeMcpServerFingerprint(name, config),
    );

    const record: MindTrustRecord = {
      mindId,
      resolvedPath,
      source: existing?.source ?? 'local',
      status: 'trusted',
      grantedAt: new Date().toISOString(),
      revokedAt: null,
      policyVersion: TRUST_POLICY_VERSION,
      approvedMcpFingerprints,
      approvedCronFingerprints: existing?.approvedCronFingerprints ?? [],
    };
    this.records.set(mindId, record);
    this.persist();
  }

  revokeTrust(mindId: string): void {
    const existing = this.records.get(mindId);
    if (!existing || existing.status === 'revoked') return;

    const updated: MindTrustRecord = {
      ...existing,
      status: 'revoked',
      revokedAt: new Date().toISOString(),
      approvedMcpFingerprints: [],
      approvedCronFingerprints: [],
    };
    this.records.set(mindId, updated);
    this.persist();
  }

  getTrustStatus(mindId: string): MindTrustStatusResult | null {
    const record = this.records.get(mindId);
    if (!record) return null;
    return {
      mindId,
      status: record.status,
      approvedCronCount: record.approvedCronFingerprints.length,
      approvedMcpCount: record.approvedMcpFingerprints.length,
    };
  }

  runMigration(
    mindRecords: ReadonlyArray<{ id: string; path: string }>,
    readMcpServers: (mindPath: string) => Record<string, MCPServerConfig>,
  ): void {
    let changed = false;

    for (const { id, path: mindPath } of mindRecords) {
      // Migration is idempotent: skip minds already in the ledger.
      if (this.records.has(id)) continue;

      const resolvedPath = resolveCanonicalPath(mindPath);
      const pathIsReachable = resolvedPath !== null && fs.existsSync(resolvedPath);

      if (!pathIsReachable) {
        // Unreachable workspace: create pending record.
        this.records.set(id, {
          mindId: id,
          resolvedPath: resolvedPath ?? mindPath,
          source: 'local',
          status: 'pending',
          grantedAt: null,
          revokedAt: null,
          policyVersion: TRUST_POLICY_VERSION,
          approvedMcpFingerprints: [],
          approvedCronFingerprints: [],
        });
        changed = true;
        continue;
      }

      // Reachable workspace: grant trusted status with fingerprinted MCP snapshot.
      let mcpServers: Record<string, MCPServerConfig> = {};
      try {
        mcpServers = readMcpServers(resolvedPath);
      } catch (err) {
        log.warn(`Migration: failed to read MCP servers for mind ${id} at ${resolvedPath}:`, err);
      }

      const approvedMcpFingerprints = Object.entries(mcpServers).map(([name, config]) =>
        computeMcpServerFingerprint(name, config),
      );

      this.records.set(id, {
        mindId: id,
        resolvedPath,
        source: 'local',
        status: 'trusted',
        grantedAt: new Date().toISOString(),
        revokedAt: null,
        policyVersion: TRUST_POLICY_VERSION,
        approvedMcpFingerprints,
        approvedCronFingerprints: [],
      });
      changed = true;
    }

    if (changed) this.persist();
  }

  // --- Private helpers ---

  private loadRecords(): void {
    const ledger = this.ledger.read();
    this.records = new Map(ledger.records.map((r) => [r.mindId, r]));
  }

  private persist(): void {
    this.ledger.write({ version: 1, records: Array.from(this.records.values()) });
  }

  private pathsMatch(a: string, b: string): boolean {
    if (process.platform === 'win32') {
      return a.toLowerCase() === b.toLowerCase();
    }
    return a === b;
  }
}

// --- Fingerprinting ---

/**
 * Computes a stable SHA-256 fingerprint for an MCP server entry.
 * Uses deterministically sorted keys so field-order changes don't affect identity.
 * The server name is included so renaming an entry invalidates its approval.
 * Raw command, args, env, headers, etc. are never stored — only the hash.
 */
export function computeMcpServerFingerprint(
  name: string,
  config: MCPServerConfig,
): string {
  const sortedEntry = sortedJsonStringify({ name, ...config });
  return createHash('sha256').update(sortedEntry, 'utf-8').digest('hex');
}

function sortedJsonStringify(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = (value as Record<string, unknown>)[key];
  }
  return JSON.stringify(sorted, (_k, v: unknown) => {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const s: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        s[k] = (v as Record<string, unknown>)[k];
      }
      return s;
    }
    return v;
  });
}

/**
 * Resolves a canonical absolute path using realpath when available.
 * Returns null if the path cannot be resolved or doesn't exist.
 */
export function resolveCanonicalPath(p: string): string | null {
  try {
    const resolved = path.resolve(p);
    try {
      const real = fs.realpathSync.native(resolved);
      return process.platform === 'win32' ? real.toLowerCase() : real;
    } catch {
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    }
  } catch {
    return null;
  }
}
