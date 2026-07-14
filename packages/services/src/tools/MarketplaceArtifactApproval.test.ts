import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MarketplaceApprovalStore, computeArtifactDescriptorHash } from './MarketplaceApprovalStore';
import { MarketplaceEnrollmentStore } from './MarketplaceEnrollmentStore';
import type { MarketplaceArtifactDescriptor } from './toolTypes';

const FULL_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function makeNpmDescriptor(overrides: Partial<MarketplaceArtifactDescriptor> = {}): MarketplaceArtifactDescriptor {
  return {
    type: 'npm-global',
    bin: 'workiq',
    package: '@microsoft/workiq',
    version: '1.2.3',
    ...overrides,
  };
}

function makeReleaseDescriptor(overrides: Partial<MarketplaceArtifactDescriptor> = {}): MarketplaceArtifactDescriptor {
  return {
    type: 'github-release-asset',
    bin: 'teams',
    owner: 'agency-microsoft',
    repo: 'a365-cli',
    tag: 'v0.5.0',
    assetName: 'teams-win-amd64.exe',
    sha256: '0'.repeat(64),
    platform: 'win32',
    arch: 'x64',
    ...overrides,
  };
}

describe('computeArtifactDescriptorHash', () => {
  it('produces the same hash for identical npm descriptors', () => {
    const a = computeArtifactDescriptorHash(makeNpmDescriptor());
    const b = computeArtifactDescriptorHash(makeNpmDescriptor());
    expect(a).toBe(b);
  });

  it('produces a different hash when the npm package name changes', () => {
    const a = computeArtifactDescriptorHash(makeNpmDescriptor({ package: '@microsoft/workiq' }));
    const b = computeArtifactDescriptorHash(makeNpmDescriptor({ package: '@microsoft/workiq-evil' }));
    expect(a).not.toBe(b);
  });

  it('produces a different hash when the npm version changes', () => {
    const a = computeArtifactDescriptorHash(makeNpmDescriptor({ version: '1.2.3' }));
    const b = computeArtifactDescriptorHash(makeNpmDescriptor({ version: '1.2.4' }));
    expect(a).not.toBe(b);
  });

  it('produces a different hash when the binary name changes', () => {
    const a = computeArtifactDescriptorHash(makeNpmDescriptor({ bin: 'workiq' }));
    const b = computeArtifactDescriptorHash(makeNpmDescriptor({ bin: 'workiq2' }));
    expect(a).not.toBe(b);
  });

  it('produces a different hash when the release asset sha256 changes', () => {
    const a = computeArtifactDescriptorHash(makeReleaseDescriptor({ sha256: '0'.repeat(64) }));
    const b = computeArtifactDescriptorHash(makeReleaseDescriptor({ sha256: '1'.repeat(64) }));
    expect(a).not.toBe(b);
  });

  it('produces a different hash when the release asset tag changes', () => {
    const a = computeArtifactDescriptorHash(makeReleaseDescriptor({ tag: 'v0.5.0' }));
    const b = computeArtifactDescriptorHash(makeReleaseDescriptor({ tag: 'v0.5.1' }));
    expect(a).not.toBe(b);
  });

  it('produces a different hash when the release asset platform changes', () => {
    const a = computeArtifactDescriptorHash(makeReleaseDescriptor({ platform: 'win32' }));
    const b = computeArtifactDescriptorHash(makeReleaseDescriptor({ platform: 'darwin' }));
    expect(a).not.toBe(b);
  });
});

describe('MarketplaceApprovalStore', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeStore(): { store: MarketplaceApprovalStore; dir: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-approval-'));
    tempDirs.push(dir);
    return { store: new MarketplaceApprovalStore(dir), dir };
  }

  it('reports no approval when the store is empty', () => {
    const { store } = makeStore();
    expect(store.isApproved('src@sha', 'workiq', 'abc123')).toBe(false);
  });

  it('reports approved after persisting a matching approval record', () => {
    const { store } = makeStore();
    const hash = computeArtifactDescriptorHash(makeNpmDescriptor());
    store.approve({
      sourceId: 'github:org/repo',
      toolId: 'workiq',
      snapshotIdentity: `github:org/repo@${FULL_SHA}`,
      artifactDescriptorHash: hash,
      approvedAt: new Date().toISOString(),
    });
    expect(store.isApproved(`github:org/repo@${FULL_SHA}`, 'workiq', hash)).toBe(true);
  });

  it('does not approve a different artifact hash for the same snapshot and tool', () => {
    const { store } = makeStore();
    const hash = computeArtifactDescriptorHash(makeNpmDescriptor());
    store.approve({
      sourceId: 'github:org/repo',
      toolId: 'workiq',
      snapshotIdentity: `github:org/repo@${FULL_SHA}`,
      artifactDescriptorHash: hash,
      approvedAt: new Date().toISOString(),
    });
    expect(store.isApproved(`github:org/repo@${FULL_SHA}`, 'workiq', 'different-hash')).toBe(false);
  });

  it('revokes an approval', () => {
    const { store } = makeStore();
    const hash = computeArtifactDescriptorHash(makeNpmDescriptor());
    const snap = `github:org/repo@${FULL_SHA}`;
    store.approve({ sourceId: 'github:org/repo', toolId: 'workiq', snapshotIdentity: snap, artifactDescriptorHash: hash, approvedAt: '2026-01-01T00:00:00Z' });
    expect(store.isApproved(snap, 'workiq', hash)).toBe(true);

    store.revoke(snap, 'workiq');
    expect(store.isApproved(snap, 'workiq', hash)).toBe(false);
  });

  it('a new approval replaces the old one for the same snapshot and tool', () => {
    const { store } = makeStore();
    const hash1 = computeArtifactDescriptorHash(makeNpmDescriptor({ version: '1.0.0' }));
    const hash2 = computeArtifactDescriptorHash(makeNpmDescriptor({ version: '2.0.0' }));
    const snap = `github:org/repo@${FULL_SHA}`;
    store.approve({ sourceId: 'github:org/repo', toolId: 'workiq', snapshotIdentity: snap, artifactDescriptorHash: hash1, approvedAt: '2026-01-01T00:00:00Z' });
    store.approve({ sourceId: 'github:org/repo', toolId: 'workiq', snapshotIdentity: snap, artifactDescriptorHash: hash2, approvedAt: '2026-01-02T00:00:00Z' });

    expect(store.isApproved(snap, 'workiq', hash1)).toBe(false);
    expect(store.isApproved(snap, 'workiq', hash2)).toBe(true);
    expect(store.loadAll()).toHaveLength(1);
  });

  it('persists approval records across store instances', () => {
    const { dir } = makeStore();
    const store1 = new MarketplaceApprovalStore(dir);
    const hash = computeArtifactDescriptorHash(makeNpmDescriptor());
    const snap = `github:org/repo@${FULL_SHA}`;
    store1.approve({ sourceId: 'github:org/repo', toolId: 'workiq', snapshotIdentity: snap, artifactDescriptorHash: hash, approvedAt: '2026-01-01T00:00:00Z' });

    const store2 = new MarketplaceApprovalStore(dir);
    expect(store2.isApproved(snap, 'workiq', hash)).toBe(true);
  });
});

describe('MarketplaceEnrollmentStore', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeStore(): { store: MarketplaceEnrollmentStore; dir: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-enrollment-'));
    tempDirs.push(dir);
    return { store: new MarketplaceEnrollmentStore(dir), dir };
  }

  it('returns undefined for an unknown source', () => {
    const { store } = makeStore();
    expect(store.findBySource('github:org/repo')).toBeUndefined();
  });

  it('persists and retrieves an enrollment record', () => {
    const { store } = makeStore();
    store.enroll({
      sourceId: 'github:org/repo',
      owner: 'org',
      repo: 'repo',
      plugin: 'my-plugin',
      commitSha: FULL_SHA,
      manifestPath: 'plugins/my-plugin/plugin.json',
      manifestDigest: 'deadbeef',
      enrolledAt: '2026-01-01T00:00:00Z',
    });
    const record = store.findBySource('github:org/repo');
    expect(record?.commitSha).toBe(FULL_SHA);
    expect(record?.manifestDigest).toBe('deadbeef');
  });

  it('overwrites an existing record when re-enrolling the same source', () => {
    const { store } = makeStore();
    store.enroll({ sourceId: 'github:org/repo', owner: 'org', repo: 'repo', plugin: 'p', commitSha: FULL_SHA, manifestPath: 'plugins/p/plugin.json', manifestDigest: 'old', enrolledAt: '2026-01-01T00:00:00Z' });
    const newSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    store.enroll({ sourceId: 'github:org/repo', owner: 'org', repo: 'repo', plugin: 'p', commitSha: newSha, manifestPath: 'plugins/p/plugin.json', manifestDigest: 'new', enrolledAt: '2026-01-02T00:00:00Z' });

    const all = store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].commitSha).toBe(newSha);
    expect(all[0].manifestDigest).toBe('new');
  });

  it('persists enrollment records across store instances', () => {
    const { dir } = makeStore();
    const store1 = new MarketplaceEnrollmentStore(dir);
    store1.enroll({ sourceId: 'github:org/repo', owner: 'org', repo: 'repo', plugin: 'p', commitSha: FULL_SHA, manifestPath: 'plugins/p/plugin.json', manifestDigest: 'digest', enrolledAt: '2026-01-01T00:00:00Z' });

    const store2 = new MarketplaceEnrollmentStore(dir);
    expect(store2.findBySource('github:org/repo')?.commitSha).toBe(FULL_SHA);
  });
});
