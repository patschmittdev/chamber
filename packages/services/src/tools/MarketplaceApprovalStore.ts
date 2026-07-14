import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MarketplaceArtifactDescriptor } from './toolTypes';

export interface ApprovalRecord {
  sourceId: string;
  toolId: string;
  /** `${sourceId}@${commitSha}` — uniquely identifies the snapshot being approved. */
  snapshotIdentity: string;
  /** SHA-256 of the canonical MarketplaceArtifactDescriptor. */
  artifactDescriptorHash: string;
  approvedAt: string;
}

const APPROVAL_FILE = 'chamber-marketplace-approvals.json';

/**
 * Persists explicit operator approval records for marketplace tool artifacts.
 * An approval is keyed by (snapshotIdentity, toolId, artifactDescriptorHash).
 * Any change to executable-affecting fields changes the hash, invalidating prior
 * approvals and requiring fresh operator confirmation. Writes are atomic.
 */
export class MarketplaceApprovalStore {
  private readonly filePath: string;

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, APPROVAL_FILE);
  }

  loadAll(): ApprovalRecord[] {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const data: unknown = JSON.parse(content);
      if (!Array.isArray(data)) return [];
      return data as ApprovalRecord[];
    } catch {
      return [];
    }
  }

  isApproved(snapshotIdentity: string, toolId: string, artifactDescriptorHash: string): boolean {
    return this.loadAll().some(
      (r) =>
        r.snapshotIdentity === snapshotIdentity
        && r.toolId === toolId
        && r.artifactDescriptorHash === artifactDescriptorHash,
    );
  }

  approve(record: ApprovalRecord): void {
    const all = this.loadAll().filter(
      (r) => !(r.snapshotIdentity === record.snapshotIdentity && r.toolId === record.toolId),
    );
    all.push(record);
    this.write(all);
  }

  revoke(snapshotIdentity: string, toolId: string): void {
    const all = this.loadAll().filter(
      (r) => !(r.snapshotIdentity === snapshotIdentity && r.toolId === toolId),
    );
    this.write(all);
  }

  private write(records: ApprovalRecord[]): void {
    const content = JSON.stringify(records, null, 2);
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmp, content, 'utf-8');
      fs.renameSync(tmp, this.filePath);
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      throw error;
    }
  }
}

/**
 * Produces a deterministic hash over the executable-affecting fields of an
 * artifact descriptor. Any change to these fields produces a different hash,
 * which invalidates a prior approval record.
 */
export function computeArtifactDescriptorHash(descriptor: MarketplaceArtifactDescriptor): string {
  const canonical = Object.fromEntries(
    Object.entries(descriptor)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
