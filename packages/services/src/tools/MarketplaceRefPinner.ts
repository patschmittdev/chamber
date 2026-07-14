import fs from 'node:fs';
import path from 'node:path';
import type { ToolMarketplaceSource } from './toolTypes';

const IMMUTABLE_SHA_RE = /^[0-9a-f]{40}$/i;

function isImmutableSha(ref: string): boolean {
  return IMMUTABLE_SHA_RE.test(ref);
}

export interface IMarketplaceRefPinStore {
  loadPin(sourceId: string): string | undefined;
  savePin(sourceId: string, sha: string): void;
}

export interface IRefResolver {
  resolveCommitSha(owner: string, repo: string, ref: string): Promise<string>;
}

/**
 * Resolves mutable marketplace source refs (branch names, tags) to immutable
 * commit SHAs before they are consumed by `MarketplaceToolCatalog`, which
 * rejects non-SHA refs at runtime.
 *
 * Pinned SHAs are persisted so repeated calls are cheap and do not require a
 * network round-trip once a source has been pinned.
 */
export class MarketplaceRefPinner {
  constructor(
    private readonly store: IMarketplaceRefPinStore,
    private readonly resolver: IRefResolver,
  ) {}

  async pinSources(sources: ToolMarketplaceSource[]): Promise<ToolMarketplaceSource[]> {
    return Promise.all(sources.map((source) => this.pinSource(source)));
  }

  private async pinSource(source: ToolMarketplaceSource): Promise<ToolMarketplaceSource> {
    if (isImmutableSha(source.ref)) {
      return source;
    }
    const sourceId = source.id ?? `github:${source.owner}/${source.repo}`;
    const cached = this.store.loadPin(sourceId);
    if (cached) {
      return { ...source, ref: cached };
    }
    const sha = await this.resolver.resolveCommitSha(source.owner, source.repo, source.ref);
    this.store.savePin(sourceId, sha);
    return { ...source, ref: sha };
  }
}

const PIN_FILE = 'marketplace-ref-pins.json';

/**
 * File-backed store for persisting resolved marketplace ref SHAs across
 * sessions. Stored in `userDataDir` under `marketplace-ref-pins.json`.
 * Load failures are silent (starts empty); persist failures are best-effort.
 */
export class ToolMarketplaceRefPinStore implements IMarketplaceRefPinStore {
  private readonly pins = new Map<string, string>();
  private readonly filePath: string;

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, PIN_FILE);
    this.load();
  }

  loadPin(sourceId: string): string | undefined {
    return this.pins.get(sourceId);
  }

  savePin(sourceId: string, sha: string): void {
    this.pins.set(sourceId, sha);
    this.persist();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string' && isImmutableSha(v)) {
          this.pins.set(k, v);
        }
      }
    } catch {
      // No store file yet; start with an empty pin map.
    }
  }

  private persist(): void {
    try {
      const data = Object.fromEntries(this.pins);
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // Best-effort; a persist failure is not fatal.
    }
  }
}
