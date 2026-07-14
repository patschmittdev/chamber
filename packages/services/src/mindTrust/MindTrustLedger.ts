// Atomic JSON persistence for the trust ledger.
// Writes to a .tmp sibling first, then renames, to avoid partial writes.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TrustLedger } from './types';

export const TRUST_LEDGER_FILENAME = 'chamber-trust-ledger.json';
export const LEDGER_VERSION = 1;

const EMPTY_LEDGER: TrustLedger = { version: LEDGER_VERSION, records: [] };

export class MindTrustLedger {
  private readonly ledgerPath: string;

  constructor(userDataPath: string) {
    this.ledgerPath = path.join(userDataPath, TRUST_LEDGER_FILENAME);
  }

  read(): TrustLedger {
    try {
      const raw = fs.readFileSync(this.ledgerPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (!isValidLedger(parsed)) return { ...EMPTY_LEDGER };
      return parsed;
    } catch {
      // Fail closed: any IO or parse error produces an empty ledger.
      return { ...EMPTY_LEDGER };
    }
  }

  write(ledger: TrustLedger): void {
    const dir = path.dirname(this.ledgerPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.ledgerPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), { encoding: 'utf-8' });
    fs.renameSync(tmp, this.ledgerPath);
  }
}

function isValidLedger(value: unknown): value is TrustLedger {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate['version'] !== 'number') return false;
  if (!Array.isArray(candidate['records'])) return false;
  return candidate['records'].every(isValidRecord);
}

function isValidRecord(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['mindId'] === 'string' &&
    typeof r['resolvedPath'] === 'string' &&
    typeof r['source'] === 'string' &&
    (r['status'] === 'pending' || r['status'] === 'trusted' || r['status'] === 'revoked') &&
    (r['grantedAt'] === null || typeof r['grantedAt'] === 'string') &&
    (r['revokedAt'] === null || typeof r['revokedAt'] === 'string') &&
    typeof r['policyVersion'] === 'number' &&
    Array.isArray(r['approvedMcpFingerprints']) &&
    Array.isArray(r['approvedCronFingerprints'])
  );
}
