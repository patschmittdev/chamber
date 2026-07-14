import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface EnrollmentRecord {
  sourceId: string;
  owner: string;
  repo: string;
  plugin: string;
  commitSha: string;
  manifestPath: string;
  manifestDigest: string;
  enrolledAt: string;
}

const ENROLLMENT_FILE = 'chamber-marketplace-enrollments.json';

/**
 * Persists marketplace source enrollment records under the app's userData directory.
 * Each record binds a source ID to a specific immutable commit SHA and the
 * content digest of the manifest at that commit. Writes are atomic (tmp + rename).
 */
export class MarketplaceEnrollmentStore {
  private readonly filePath: string;

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, ENROLLMENT_FILE);
  }

  loadAll(): EnrollmentRecord[] {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const data: unknown = JSON.parse(content);
      if (!Array.isArray(data)) return [];
      return data as EnrollmentRecord[];
    } catch {
      return [];
    }
  }

  findBySource(sourceId: string): EnrollmentRecord | undefined {
    return this.loadAll().find((r) => r.sourceId === sourceId);
  }

  enroll(record: EnrollmentRecord): void {
    const all = this.loadAll().filter((r) => r.sourceId !== record.sourceId);
    all.push(record);
    this.write(all);
  }

  private write(records: EnrollmentRecord[]): void {
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

/** Computes a SHA-256 digest of the canonical JSON representation of a manifest. */
export function computeManifestDigest(content: unknown): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}
