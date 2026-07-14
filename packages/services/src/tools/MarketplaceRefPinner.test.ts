import { describe, it, expect, vi } from 'vitest';
import { MarketplaceRefPinner } from './MarketplaceRefPinner';
import type { IMarketplaceRefPinStore, IRefResolver } from './MarketplaceRefPinner';
import type { ToolMarketplaceSource } from './toolTypes';

const FULL_SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const RESOLVED_SHA = '1111111111111111111111111111111111111111';

const PINNED_SOURCE: ToolMarketplaceSource = {
  id: 'github:acme/marketplace',
  owner: 'acme',
  repo: 'marketplace',
  ref: FULL_SHA,
  plugin: 'acme-tools',
  enabled: true,
};

const MUTABLE_SOURCE: ToolMarketplaceSource = {
  id: 'github:acme/marketplace',
  owner: 'acme',
  repo: 'marketplace',
  ref: 'master',
  plugin: 'acme-tools',
  enabled: true,
};

function makeStore(cachedPin?: string): IMarketplaceRefPinStore & {
  loadPin: ReturnType<typeof vi.fn>;
  savePin: ReturnType<typeof vi.fn>;
} {
  return {
    loadPin: vi.fn(() => cachedPin),
    savePin: vi.fn(),
  } as IMarketplaceRefPinStore & {
    loadPin: ReturnType<typeof vi.fn>;
    savePin: ReturnType<typeof vi.fn>;
  };
}

function makeClient(resolvedSha: string): IRefResolver & {
  resolveCommitSha: ReturnType<typeof vi.fn>;
} {
  return {
    resolveCommitSha: vi.fn(async () => resolvedSha),
  } as IRefResolver & {
    resolveCommitSha: ReturnType<typeof vi.fn>;
  };
}

describe('MarketplaceRefPinner', () => {
  it('passes through a source with a full 40-character SHA unchanged', async () => {
    const store = makeStore();
    const client = makeClient(RESOLVED_SHA);
    const pinner = new MarketplaceRefPinner(store, client);

    const result = await pinner.pinSources([PINNED_SOURCE]);

    expect(result).toHaveLength(1);
    expect(result[0].ref).toBe(FULL_SHA);
    expect(client.resolveCommitSha).not.toHaveBeenCalled();
    expect(store.loadPin).not.toHaveBeenCalled();
  });

  it('returns a source with a mutable ref replaced by a cached pin', async () => {
    const store = makeStore(RESOLVED_SHA);
    const client = makeClient('should-not-be-called');
    const pinner = new MarketplaceRefPinner(store, client);

    const result = await pinner.pinSources([MUTABLE_SOURCE]);

    expect(result[0].ref).toBe(RESOLVED_SHA);
    expect(client.resolveCommitSha).not.toHaveBeenCalled();
    expect(store.loadPin).toHaveBeenCalledWith('github:acme/marketplace');
  });

  it('resolves a mutable ref via the client when no cached pin exists', async () => {
    const store = makeStore(undefined);
    const client = makeClient(RESOLVED_SHA);
    const pinner = new MarketplaceRefPinner(store, client);

    const result = await pinner.pinSources([MUTABLE_SOURCE]);

    expect(result[0].ref).toBe(RESOLVED_SHA);
    expect(client.resolveCommitSha).toHaveBeenCalledWith('acme', 'marketplace', 'master');
  });

  it('persists the resolved SHA to the store after a successful resolve', async () => {
    const store = makeStore(undefined);
    const client = makeClient(RESOLVED_SHA);
    const pinner = new MarketplaceRefPinner(store, client);

    await pinner.pinSources([MUTABLE_SOURCE]);

    expect(store.savePin).toHaveBeenCalledWith('github:acme/marketplace', RESOLVED_SHA);
  });

  it('preserves all other source fields when replacing the ref', async () => {
    const store = makeStore(undefined);
    const client = makeClient(RESOLVED_SHA);
    const pinner = new MarketplaceRefPinner(store, client);

    const result = await pinner.pinSources([MUTABLE_SOURCE]);

    expect(result[0]).toEqual({
      ...MUTABLE_SOURCE,
      ref: RESOLVED_SHA,
    });
  });

  it('propagates errors when GitHub resolution fails and no cache exists', async () => {
    const store = makeStore(undefined);
    const client = {
      resolveCommitSha: vi.fn(async () => { throw new Error('network error'); }),
    } as IRefResolver & { resolveCommitSha: ReturnType<typeof vi.fn> };
    const pinner = new MarketplaceRefPinner(store, client);

    await expect(pinner.pinSources([MUTABLE_SOURCE])).rejects.toThrow('network error');
  });

  it('uses the source owner/repo as the sourceId when source.id is absent', async () => {
    const sourceWithoutId: ToolMarketplaceSource = {
      owner: 'acme',
      repo: 'marketplace',
      ref: 'main',
      plugin: 'tools',
    };
    const store = makeStore(RESOLVED_SHA);
    const client = makeClient('should-not-be-called');
    const pinner = new MarketplaceRefPinner(store, client);

    await pinner.pinSources([sourceWithoutId]);

    expect(store.loadPin).toHaveBeenCalledWith('github:acme/marketplace');
  });

  it('pins each source independently in a multi-source list', async () => {
    const second: ToolMarketplaceSource = {
      id: 'github:other/repo',
      owner: 'other',
      repo: 'repo',
      ref: 'main',
      plugin: 'tools',
    };
    const secondSha = '2222222222222222222222222222222222222222';
    const store = {
      loadPin: vi.fn(() => undefined),
      savePin: vi.fn(),
    } as IMarketplaceRefPinStore & { loadPin: ReturnType<typeof vi.fn>; savePin: ReturnType<typeof vi.fn> };
    const client = {
      resolveCommitSha: vi.fn()
        .mockResolvedValueOnce(RESOLVED_SHA)
        .mockResolvedValueOnce(secondSha),
    } as IRefResolver & { resolveCommitSha: ReturnType<typeof vi.fn> };
    const pinner = new MarketplaceRefPinner(store, client);

    const result = await pinner.pinSources([MUTABLE_SOURCE, second]);

    expect(result[0].ref).toBe(RESOLVED_SHA);
    expect(result[1].ref).toBe(secondSha);
    expect(store.savePin).toHaveBeenCalledTimes(2);
  });
});
