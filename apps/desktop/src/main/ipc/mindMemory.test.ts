import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { MindWorkingMemory } from '@chamber/shared/types';
import type { MindMemoryService } from '@chamber/services';
import { setupMindMemoryIPC } from './mindMemory';

const EVT = {} as IpcMainInvokeEvent;
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const CHANNEL = 'mindMemory:read';

function memoryFor(mindId: string): MindWorkingMemory {
  return {
    mindId,
    present: true,
    files: [
      { name: 'memory.md', label: 'Memory', present: true, content: 'note', truncated: false, mtimeMs: 1 },
      { name: 'rules.md', label: 'Rules', present: false, content: '', truncated: false, mtimeMs: null },
      { name: 'log.md', label: 'Log', present: false, content: '', truncated: false, mtimeMs: null },
    ],
  };
}

describe('mindMemory IPC', () => {
  const read = vi.fn<(mindId: string) => MindWorkingMemory>();

  beforeEach(() => {
    vi.clearAllMocks();
    read.mockImplementation((mindId) => memoryFor(mindId));
    setupMindMemoryIPC({ read } as unknown as MindMemoryService);
  });

  it('returns the working memory for a string mindId', async () => {
    await expect(getHandler(CHANNEL)(EVT, 'lucy')).resolves.toEqual(memoryFor('lucy'));
    expect(read).toHaveBeenCalledWith('lucy');
  });

  it('rejects a non-string mindId with a channel-labeled TypeError', async () => {
    await expect(getHandler(CHANNEL)(EVT, 42)).rejects.toThrow(TypeError);
    await expect(getHandler(CHANNEL)(EVT, 42)).rejects.toThrow(/mindMemory:read/);
    expect(read).not.toHaveBeenCalled();
  });

  it('propagates errors from the service', async () => {
    read.mockImplementation(() => {
      throw new Error('Mind ghost not found');
    });
    await expect(getHandler(CHANNEL)(EVT, 'ghost')).rejects.toThrow(/not found/);
  });
});

function getHandler(channel: string): InvokeHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((item) => item[0] === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as InvokeHandler;
}
