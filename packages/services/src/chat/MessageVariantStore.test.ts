import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChatMessage, MessageVariantGroup } from '@chamber/shared/types';
import { MessageVariantStore } from './MessageVariantStore';

function message(id: string, role: 'user' | 'assistant', text: string): ChatMessage {
  return { id, role, blocks: [{ type: 'text', content: text }], timestamp: 0 };
}

function group(groupId: string, anchorEventId: string | null): MessageVariantGroup {
  return {
    groupId,
    anchorEventId,
    frozenVariants: [
      {
        variantId: `${groupId}-v1`,
        createdAt: '2024-01-01T00:00:00.000Z',
        messages: [message('u1', 'user', 'prompt'), message('a1', 'assistant', 'answer')],
      },
    ],
  };
}

describe('MessageVariantStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chamber-variants-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function store(): MessageVariantStore {
    return new MessageVariantStore({ storageRoot: tempDir });
  }

  it('returns an empty list when nothing has been saved', async () => {
    expect(await store().read('mind-a', 'session-a')).toEqual([]);
  });

  it('round-trips saved groups', async () => {
    const groups = [group('g1', null), group('g2', 'anchor-1')];
    await store().save('mind-a', 'session-a', groups);
    expect(await store().read('mind-a', 'session-a')).toEqual(groups);
  });

  it('isolates groups by mind and session', async () => {
    await store().save('mind-a', 'session-a', [group('g1', null)]);
    expect(await store().read('mind-a', 'session-b')).toEqual([]);
    expect(await store().read('mind-b', 'session-a')).toEqual([]);
  });

  it('deletes persisted groups when saving an empty list', async () => {
    await store().save('mind-a', 'session-a', [group('g1', null)]);
    await store().save('mind-a', 'session-a', []);
    expect(await store().read('mind-a', 'session-a')).toEqual([]);
  });

  it('deletes persisted groups explicitly', async () => {
    await store().save('mind-a', 'session-a', [group('g1', null)]);
    await store().delete('mind-a', 'session-a');
    expect(await store().read('mind-a', 'session-a')).toEqual([]);
  });

  it('degrades to an empty list for malformed JSON', async () => {
    const dir = path.join(tempDir, Buffer.from('mind-a').toString('base64url'), Buffer.from('session-a').toString('base64url'));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'variants.json'), '{ not json', 'utf8');
    expect(await store().read('mind-a', 'session-a')).toEqual([]);
  });

  it('degrades to an empty list for a foreign envelope', async () => {
    const dir = path.join(tempDir, Buffer.from('mind-a').toString('base64url'), Buffer.from('session-a').toString('base64url'));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'variants.json'), JSON.stringify({ storageVersion: 2, groups: [] }), 'utf8');
    expect(await store().read('mind-a', 'session-a')).toEqual([]);
  });

  it('drops groups whose variants are all invalid', async () => {
    const dir = path.join(tempDir, Buffer.from('mind-a').toString('base64url'), Buffer.from('session-a').toString('base64url'));
    await fs.mkdir(dir, { recursive: true });
    const payload = {
      storageVersion: 1,
      mindId: 'mind-a',
      sessionId: 'session-a',
      groups: [
        { groupId: 'g1', anchorEventId: null, frozenVariants: [{ variantId: 'bad', createdAt: 't', messages: [{ nope: true }] }] },
        group('g2', 'anchor-1'),
      ],
    };
    await fs.writeFile(path.join(dir, 'variants.json'), JSON.stringify(payload), 'utf8');
    const read = await store().read('mind-a', 'session-a');
    expect(read.map((entry) => entry.groupId)).toEqual(['g2']);
  });

  it('keeps traversal ids inside the storage root by encoding path segments', async () => {
    await store().save('../escape', 'session-a', [group('g1', null)]);
    const rootEntries = await fs.readdir(tempDir);
    expect(rootEntries).not.toContain('..');
    expect(await store().read('../escape', 'session-a')).toHaveLength(1);
  });
});
