import { ipcMain } from 'electron';
import { IPC, parseIpcArgs } from '@chamber/shared';
import type { ToolsService } from '@chamber/services';
import { z } from 'zod';

const toolIdSchema = z.string().trim().min(1, 'must be a non-empty string').max(120);
const marketplaceIdSchema = z.string().trim().min(1, 'must be a non-empty string').max(240);

export function setupToolsIPC(toolsService: ToolsService): void {
  ipcMain.handle(IPC.TOOLS.LIST, async () => toolsService.list());
  ipcMain.handle(IPC.TOOLS.INSTALL, async (_event, toolId: string, marketplaceId?: string) =>
    toolsService.install(toolId, marketplaceId),
  );
  ipcMain.handle(IPC.TOOLS.UNINSTALL, async (_event, toolId: string) => toolsService.uninstall(toolId));
  ipcMain.handle(IPC.TOOLS.LIST_OPERATIONS, async () => toolsService.listOperations());
  ipcMain.handle(IPC.TOOLS.INSTALL_OPERATION, async (_event, rawToolId: unknown, rawMarketplaceId: unknown) =>
    toolsService.installForOperator(
      parseIpcArgs(IPC.TOOLS.INSTALL_OPERATION, toolIdSchema, rawToolId),
      parseIpcArgs(IPC.TOOLS.INSTALL_OPERATION, marketplaceIdSchema, rawMarketplaceId),
    ));
  ipcMain.handle(IPC.TOOLS.UPDATE_OPERATION, async (_event, rawToolId: unknown, rawMarketplaceId: unknown) =>
    toolsService.updateForOperator(
      parseIpcArgs(IPC.TOOLS.UPDATE_OPERATION, toolIdSchema, rawToolId),
      parseIpcArgs(IPC.TOOLS.UPDATE_OPERATION, marketplaceIdSchema, rawMarketplaceId),
    ));
  ipcMain.handle(IPC.TOOLS.REMOVE_OPERATION, async (_event, rawToolId: unknown, rawMarketplaceId: unknown) =>
    toolsService.removeForOperator(
      parseIpcArgs(IPC.TOOLS.REMOVE_OPERATION, toolIdSchema, rawToolId),
      parseIpcArgs(IPC.TOOLS.REMOVE_OPERATION, marketplaceIdSchema, rawMarketplaceId),
    ));
}
