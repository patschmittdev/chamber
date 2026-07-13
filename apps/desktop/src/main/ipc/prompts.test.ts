import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '@chamber/shared';
import type { Prompt, PromptMutationResult, PromptSaveRequest } from '@chamber/shared/types';
import { setupPromptsIPC } from './prompts';

const EVT = {} as IpcMainInvokeEvent;
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function prompt(id: string): Prompt {
  return { id, title: 'T', body: 'b', createdAt: 't', updatedAt: 't' };
}

describe('Prompts IPC', () => {
  const list = vi.fn<() => Prompt[]>();
  const save = vi.fn<(request: PromptSaveRequest) => PromptMutationResult>();
  const remove = vi.fn<(id: string) => PromptMutationResult>();

  beforeEach(() => {
    vi.clearAllMocks();
    list.mockReturnValue([]);
    save.mockReturnValue({ success: true, prompts: [] });
    remove.mockReturnValue({ success: true, prompts: [] });
    setupPromptsIPC({ list, save, delete: remove });
  });

  it('lists prompts through the service', async () => {
    list.mockReturnValue([prompt('a')]);
    await expect(getHandler(IPC.PROMPTS.LIST)(EVT)).resolves.toEqual([prompt('a')]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('saves a create request through the service', async () => {
    const request: PromptSaveRequest = { id: null, title: 'Standup', body: 'x' };
    save.mockReturnValue({ success: true, prompts: [prompt('new')] });
    await expect(getHandler(IPC.PROMPTS.SAVE)(EVT, request)).resolves.toEqual({
      success: true,
      prompts: [prompt('new')],
    });
    expect(save).toHaveBeenCalledWith(request);
  });

  it('saves an update request through the service', async () => {
    const request: PromptSaveRequest = { id: 'keep', title: 'New', body: 'x', description: 'd' };
    await getHandler(IPC.PROMPTS.SAVE)(EVT, request);
    expect(save).toHaveBeenCalledWith(request);
  });

  for (const [label, value] of [
    ['null', null],
    ['a number', 42],
    ['a missing title', { id: null, body: 'x' }],
    ['an empty-string id', { id: '', title: 'T', body: 'x' }],
  ] as const) {
    it(`rejects ${label} save payload without calling the service`, async () => {
      await expect(getHandler(IPC.PROMPTS.SAVE)(EVT, value)).rejects.toThrow(TypeError);
      expect(save).not.toHaveBeenCalled();
    });
  }

  it('labels the save rejection with the channel name', async () => {
    await expect(getHandler(IPC.PROMPTS.SAVE)(EVT, 42)).rejects.toThrow(/prompts:save/);
  });

  it('deletes a prompt through the service', async () => {
    remove.mockReturnValue({ success: true, prompts: [] });
    await expect(getHandler(IPC.PROMPTS.DELETE)(EVT, 'a')).resolves.toEqual({ success: true, prompts: [] });
    expect(remove).toHaveBeenCalledWith('a');
  });

  for (const [label, value] of [
    ['an empty string', ''],
    ['null', null],
    ['a number', 7],
  ] as const) {
    it(`rejects ${label} delete id without calling the service`, async () => {
      await expect(getHandler(IPC.PROMPTS.DELETE)(EVT, value)).rejects.toThrow(TypeError);
      expect(remove).not.toHaveBeenCalled();
    });
  }
});

function getHandler(channel: string): InvokeHandler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((item) => item[0] === channel);
  if (!call) throw new Error(`no handler registered for ${channel}`);
  return call[1] as InvokeHandler;
}
