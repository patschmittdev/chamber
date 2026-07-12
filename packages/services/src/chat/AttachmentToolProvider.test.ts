import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AttachmentStore } from './AttachmentStore';
import { AttachmentToolProvider } from './AttachmentToolProvider';

describe('AttachmentToolProvider', () => {
  let tempDir: string;
  const invocation = {
    sessionId: 'session-1',
    toolCallId: 'tool-call-1',
    toolName: 'attachment_read',
    arguments: {},
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chamber-attachment-tools-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('lists attachments for the scoped mind with truncation metadata', async () => {
    const store = {
      list: vi.fn(async () => ({
        attachments: [{
          id: 'att-1',
          kind: 'document' as const,
          displayName: 'notes.md',
          mimeType: 'text/markdown',
          size: 12,
        }],
        total: 2,
        limit: 1,
        truncated: true,
      })),
      read: vi.fn(),
    };
    const listTool = new AttachmentToolProvider(store).getToolsForMind('mind-a')
      .find((tool) => tool.name === 'attachment_list');
    const handler = listTool?.handler;
    if (!handler) throw new Error('Expected attachment_list handler');

    const result = await handler({ limit: 1 }, { ...invocation, toolName: 'attachment_list' });

    expect(store.list).toHaveBeenCalledWith('mind-a', 'session-1', 1);
    expect(result).toEqual({
      attachments: [{
        id: 'att-1',
        kind: 'document',
        displayName: 'notes.md',
        mimeType: 'text/markdown',
        size: 12,
      }],
      total: 2,
      limit: 1,
      truncated: true,
    });
  });

  it('reads a bounded attachment for the scoped mind', async () => {
    const store = {
      list: vi.fn(),
      read: vi.fn(async () => ({
        attachment: {
          id: 'att-1',
          kind: 'document' as const,
          displayName: 'notes.md',
          mimeType: 'text/markdown',
          size: 12,
        },
        content: '# Ti',
        bytesRead: 4,
        totalBytes: 12,
        truncated: true,
      })),
    };
    const readTool = new AttachmentToolProvider(store).getToolsForMind('mind-a')
      .find((tool) => tool.name === 'attachment_read');
    const handler = readTool?.handler;
    if (!handler) throw new Error('Expected attachment_read handler');

    const result = await handler({ attachment_id: 'att-1', max_bytes: 4 }, invocation);

    expect(store.read).toHaveBeenCalledWith('mind-a', 'session-1', 'att-1', { maxBytes: 4 });
    expect(result).toMatchObject({
      content: '# Ti',
      bytesRead: 4,
      totalBytes: 12,
      truncated: true,
    });
  });

  it('returns tool-shaped errors for invalid input and store failures', async () => {
    const store = {
      list: vi.fn(),
      read: vi.fn(async () => {
        throw new Error('Attachment not found');
      }),
    };
    const readTool = new AttachmentToolProvider(store).getToolsForMind('mind-a')
      .find((tool) => tool.name === 'attachment_read');
    const handler = readTool?.handler;
    if (!handler) throw new Error('Expected attachment_read handler');

    await expect(handler({}, invocation)).resolves.toEqual({ error: 'attachment_id is required' });
    await expect(handler({ attachment_id: 'att-missing' }, invocation)).resolves.toEqual({ error: 'Attachment not found' });
    expect(store.read).toHaveBeenCalledTimes(1);
  });

  it('rejects path-like attachment ids through the model-facing read tool', async () => {
    const store = new AttachmentStore({ storageRoot: tempDir });
    const readTool = new AttachmentToolProvider(store).getToolsForMind('mind-a')
      .find((tool) => tool.name === 'attachment_read');
    const handler = readTool?.handler;
    if (!handler) throw new Error('Expected attachment_read handler');

    for (const attachmentId of ['../../secret', '..\\secret', 'C:\\secret.txt', '/tmp/secret', 'att/secret']) {
      await expect(handler({ attachment_id: attachmentId }, invocation)).resolves.toEqual({ error: 'Attachment id is invalid' });
    }
    await expect(fs.readdir(tempDir)).resolves.toEqual([]);
  });
});
