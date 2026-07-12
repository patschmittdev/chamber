import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { ipcMain } from 'electron';
import { setupUserProfileIPC } from './userProfile';
import type { MicrosoftGraphProfileImporter, UserProfileService } from '@chamber/services';
import { IPC } from '@chamber/shared';
import type { UserProfile, UserProfileSaveRequest } from '@chamber/shared/types';

const savedProfile: UserProfile = {
  displayName: '',
  work: '',
  location: '',
  about: '',
  avatarDataUrl: null,
  customInstructions: 'Be concise.',
  source: 'local',
  updatedAt: '2026-07-12T00:00:00.000Z',
};

function createFakeService(): UserProfileService {
  return {
    getProfile: vi.fn().mockReturnValue(savedProfile),
    saveProfile: vi.fn().mockReturnValue(savedProfile),
  } as unknown as UserProfileService;
}

function createFakeImporter(): MicrosoftGraphProfileImporter {
  return {
    importProfile: vi.fn().mockResolvedValue({ success: false, error: 'not stubbed' }),
  } as unknown as MicrosoftGraphProfileImporter;
}

function findHandler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`No handler registered for ${channel}`);
  return call[1];
}

describe('setupUserProfileIPC', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
  });

  it('registers get, save, and import handlers', () => {
    setupUserProfileIPC(createFakeService(), createFakeImporter());
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC.USER_PROFILE.GET);
    expect(channels).toContain(IPC.USER_PROFILE.SAVE);
    expect(channels).toContain(IPC.USER_PROFILE.IMPORT_FROM_MICROSOFT);
  });

  it('save persists the profile and fires onProfileSaved so minds refresh', async () => {
    const service = createFakeService();
    const onProfileSaved = vi.fn().mockResolvedValue(undefined);
    setupUserProfileIPC(service, createFakeImporter(), { onProfileSaved });

    const request: UserProfileSaveRequest = { customInstructions: 'Be concise.' };
    const result = await findHandler(IPC.USER_PROFILE.SAVE)({} as never, request);

    expect(service.saveProfile).toHaveBeenCalledWith(request);
    expect(onProfileSaved).toHaveBeenCalledTimes(1);
    expect(result).toEqual(savedProfile);
  });

  it('save returns the persisted profile even without an onProfileSaved callback', async () => {
    const service = createFakeService();
    setupUserProfileIPC(service, createFakeImporter());

    const result = await findHandler(IPC.USER_PROFILE.SAVE)({} as never, { customInstructions: 'x' });

    expect(result).toEqual(savedProfile);
  });
});
