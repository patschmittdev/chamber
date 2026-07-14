// Types for the per-mind execution trust boundary (Stage 1).

import type { MCPServerConfig } from '@github/copilot-sdk';
import type { MindTrustStatusResult } from '@chamber/shared/mind-trust-types';

export type TrustStatus = 'pending' | 'trusted' | 'revoked';
export type MindSourceCategory = 'local' | 'imported';

export type { MindTrustStatusResult };

/** Per-mind trust record stored in the ledger. */
export interface MindTrustRecord {
  mindId: string;
  /** Canonical realpath of the workspace at the time of registration or migration. */
  resolvedPath: string;
  source: MindSourceCategory;
  status: TrustStatus;
  /** ISO-8601 timestamp when trust was granted, or null if not yet granted. */
  grantedAt: string | null;
  /** ISO-8601 timestamp when trust was revoked, or null if not revoked. */
  revokedAt: string | null;
  policyVersion: number;
  /** SHA-256 hex fingerprints of approved MCP server entries. */
  approvedMcpFingerprints: string[];
  /** SHA-256 hex fingerprints of approved cron job script paths. */
  approvedCronFingerprints: string[];
}

/** Top-level structure of the on-disk JSON ledger. */
export interface TrustLedger {
  version: number;
  records: MindTrustRecord[];
}

/** Injectable interface used by CronService and MindManager. */
export interface IMindTrustService {
  /**
   * Register a mind on load. Creates a pending record if not in ledger.
   * Validates stored path against `resolvedPath`; mismatches result in pending.
   */
  registerMindLoad(mindId: string, resolvedPath: string, source: MindSourceCategory): void;

  /**
   * Returns true only when the mind has `trusted` status AND `resolvedPath`
   * matches the ledger record exactly. Returns false for pending, revoked,
   * path mismatch, or missing record.
   */
  isMindTrustedForExecution(mindId: string, resolvedPath: string): boolean;

  /**
   * Returns the subset of `servers` whose fingerprint is in the mind's approved
   * MCP fingerprint list. Returns an empty object when the mind is not trusted,
   * or when path mismatches the ledger record.
   */
  getApprovedMcpServers(
    mindId: string,
    resolvedPath: string,
    servers: Record<string, MCPServerConfig>,
  ): Record<string, MCPServerConfig>;

  /**
   * Grants trust for a registered pending mind.
   * Computes and stores fingerprints for the mind's current MCP servers.
   * No-op if already trusted.
   */
  grantTrust(mindId: string): void;

  /**
   * Revokes trust for a mind. Clears approved fingerprints. Idempotent.
   */
  revokeTrust(mindId: string): void;

  /** Returns trust status for a given mindId, or null if unknown. */
  getTrustStatus(mindId: string): MindTrustStatusResult | null;

  /**
   * One-time idempotent migration for minds already registered in the config
   * store. Existing minds get a legacy `trusted` grant; unreachable paths get
   * `pending`. Never executes scripts or starts MCP servers.
   */
  runMigration(
    mindRecords: ReadonlyArray<{ id: string; path: string }>,
    readMcpServers: (mindPath: string) => Record<string, MCPServerConfig>,
  ): void;
}
