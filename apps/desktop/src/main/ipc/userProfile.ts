import { ipcMain } from 'electron';
import { IPC } from '@chamber/shared';
import type { MicrosoftGraphProfileImporter, UserProfileService } from '@chamber/services';
import type { UserProfileSaveRequest } from '@chamber/shared/types';

export interface UserProfileIPCOptions {
  /**
   * Invoked after a profile save persists. Used to refresh loaded minds so
   * global custom instructions reach already-running agents. Best-effort: the
   * caller owns error handling so a refresh failure never fails the save.
   */
  onProfileSaved?: () => void | Promise<void>;
}

export function setupUserProfileIPC(
  userProfileService: UserProfileService,
  microsoftGraphProfileImporter: MicrosoftGraphProfileImporter,
  options: UserProfileIPCOptions = {},
): void {
  ipcMain.handle(IPC.USER_PROFILE.GET, async () => userProfileService.getProfile());
  ipcMain.handle(IPC.USER_PROFILE.SAVE, async (_event, request: UserProfileSaveRequest) => {
    const profile = userProfileService.saveProfile(request);
    await options.onProfileSaved?.();
    return profile;
  });
  ipcMain.handle(IPC.USER_PROFILE.IMPORT_FROM_MICROSOFT, async () =>
    microsoftGraphProfileImporter.importProfile(),
  );
}
