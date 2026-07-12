import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AttachmentStore } from './AttachmentStore';

describe('AttachmentStore', () => {
  let tempDir: string;
  let nextId = 1;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chamber-attachments-'));
    nextId = 1;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function store(maxAttachmentBytes = 256 * 1024): AttachmentStore {
    return new AttachmentStore({
      storageRoot: tempDir,
      maxAttachmentBytes,
      clock: { now: () => new Date('2026-05-05T22:00:00.000Z') },
      idGenerator: { nextId: () => `id-${nextId++}` },
    });
  }

  it('writes metadata and payload into the final app-owned directory', async () => {
    const saved = await store().saveDocument('mind-a', 'session-a', {
      kind: 'document',
      clientId: 'draft-1',
      displayName: 'notes.md',
      mimeType: 'text/markdown',
      size: 7,
      content: '# Title',
    });

    const mindDirs = await fs.readdir(path.join(tempDir, 'minds'));
    const sessionDirs = await fs.readdir(path.join(tempDir, 'minds', mindDirs[0], 'sessions'));
    const finalDir = path.join(tempDir, 'minds', mindDirs[0], 'sessions', sessionDirs[0], saved.id);
    expect((await fs.stat(path.join(finalDir, 'metadata.json'))).isFile()).toBe(true);
    expect((await fs.stat(path.join(finalDir, 'payload.txt'))).isFile()).toBe(true);
    expect((await fs.readdir(finalDir)).sort()).toEqual(['metadata.json', 'payload.txt']);
    const parentEntries = await fs.readdir(path.dirname(finalDir));
    expect(parentEntries.some((entry) => entry.includes('.tmp-'))).toBe(false);
  });

  it('rejects malformed metadata instead of returning a success-shaped result', async () => {
    const saved = await store().saveDocument('mind-a', 'session-a', {
      kind: 'document',
      clientId: 'draft-1',
      displayName: 'notes.md',
      mimeType: 'text/markdown',
      size: 7,
      content: '# Title',
    });
    const finalDir = await attachmentDir(saved.id);
    await fs.writeFile(path.join(finalDir, 'metadata.json'), '{ not json', 'utf8');

    await expect(store().list('mind-a', 'session-a')).rejects.toThrow('Attachment metadata is malformed');
    await expect(store().read('mind-a', 'session-a', saved.id)).rejects.toThrow('Attachment metadata is malformed');
  });

  it('rejects missing payloads', async () => {
    const saved = await store().saveDocument('mind-a', 'session-a', {
      kind: 'document',
      clientId: 'draft-1',
      displayName: 'notes.md',
      mimeType: 'text/markdown',
      size: 7,
      content: '# Title',
    });
    const finalDir = await attachmentDir(saved.id);
    await fs.rm(path.join(finalDir, 'payload.txt'));

    await expect(store().read('mind-a', 'session-a', saved.id)).rejects.toThrow('Attachment payload is missing');
  });

  it('enforces configured size limits before writing', async () => {
    await expect(store(4).saveDocument('mind-a', 'session-a', {
      kind: 'document',
      clientId: 'draft-1',
      displayName: 'large.txt',
      mimeType: 'text/plain',
      size: 5,
      content: '12345',
    })).rejects.toThrow('exceeds the 4 byte limit');

    expect(await fs.readdir(tempDir)).toEqual([]);
  });

  it('does not persist original absolute paths in metadata', async () => {
    const saved = await store().saveDocument('mind-a', 'session-a', {
      kind: 'document',
      clientId: 'draft-1',
      displayName: 'C:\\Users\\pat\\secret.txt',
      mimeType: 'text/plain',
      size: 6,
      content: 'secret',
      metadata: { originalPath: 'C:\\Users\\pat\\secret.txt', source: 'test' },
    });

    expect(saved.displayName).toBe('secret.txt');
    expect(saved.metadata).toEqual({ source: 'test' });
    const finalDir = await attachmentDir(saved.id);
    const rawMetadata = await fs.readFile(path.join(finalDir, 'metadata.json'), 'utf8');
    expect(rawMetadata).not.toContain('C:\\Users\\pat');
  });

  it('bounds reads and reports truncation metadata', async () => {
    const saved = await store().saveDocument('mind-a', 'session-a', {
      kind: 'document',
      clientId: 'draft-1',
      displayName: 'notes.txt',
      mimeType: 'text/plain',
      size: 10,
      content: '0123456789',
    });

    const result = await store().read('mind-a', 'session-a', saved.id, { maxBytes: 4 });

    expect(result).toMatchObject({
      content: '0123',
      bytesRead: 4,
      totalBytes: 10,
      truncated: true,
    });
  });

  it('scopes list and read to the originating session', async () => {
    const attachmentStore = store();
    const first = await attachmentStore.saveDocument('mind-a', 'session-a', {
      kind: 'document',
      clientId: 'draft-1',
      displayName: 'first.txt',
      mimeType: 'text/plain',
      size: 5,
      content: 'first',
    });
    const second = await attachmentStore.saveDocument('mind-a', 'session-b', {
      kind: 'document',
      clientId: 'draft-2',
      displayName: 'second.txt',
      mimeType: 'text/plain',
      size: 6,
      content: 'second',
    });

    await expect(attachmentStore.list('mind-a', 'session-a')).resolves.toMatchObject({
      attachments: [expect.objectContaining({ id: first.id, displayName: 'first.txt' })],
      total: 1,
    });
    await expect(attachmentStore.read('mind-a', 'session-a', second.id)).rejects.toThrow('Attachment metadata is missing');
    await expect(attachmentStore.read('mind-a', 'session-b', first.id)).rejects.toThrow('Attachment metadata is missing');
  });

  async function attachmentDir(attachmentId: string): Promise<string> {
    const mindDirs = await fs.readdir(path.join(tempDir, 'minds'));
    const sessionDirs = await fs.readdir(path.join(tempDir, 'minds', mindDirs[0], 'sessions'));
    return path.join(tempDir, 'minds', mindDirs[0], 'sessions', sessionDirs[0], attachmentId);
  }
});
