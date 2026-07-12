import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';

import { IPC, parseIpcArgs } from '@chamber/shared';
import type { OperatorActivitySnapshot } from '@chamber/shared/operator-activity-types';
import type { OperatorActivityService } from '@chamber/services';

const noArgsSchema = z.tuple([]);

type OperatorActivityIpcService = Pick<
  OperatorActivityService,
  'getSnapshot' | 'subscribeChanged'
>;

export function setupOperatorActivityIPC(service: OperatorActivityIpcService): void {
  ipcMain.handle(IPC.OPERATOR_ACTIVITY.GET_SNAPSHOT, async (_event, ...args: unknown[]): Promise<OperatorActivitySnapshot> => {
    parseIpcArgs(IPC.OPERATOR_ACTIVITY.GET_SNAPSHOT, noArgsSchema, args);
    return service.getSnapshot();
  });

  service.subscribeChanged((snapshot) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.OPERATOR_ACTIVITY.CHANGED, snapshot);
      }
    }
  });
}
