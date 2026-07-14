import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC, parseIpcArgs } from '@chamber/shared';
import type { CapabilityInventoryQuery, CapabilityInventoryResult } from '@chamber/shared';

const querySchema = z.object({
  mindId: z.string().trim().min(1, 'must be a non-empty string').optional(),
  availability: z.enum(['installed', 'available', 'all']).optional(),
}).strict().optional().default({});

export interface CapabilityInventoryMindProvider {
  getMindPath(mindId: string): string | undefined;
}

export interface CapabilityInventoryPort {
  list(query?: CapabilityInventoryQuery, mindPath?: string): Promise<CapabilityInventoryResult>;
}

/** Thin, read-only IPC adapter for the renderer-safe capability inventory. */
export function setupCapabilitiesIPC(
  mindProvider: CapabilityInventoryMindProvider,
  inventory: CapabilityInventoryPort,
): void {
  ipcMain.handle(IPC.CAPABILITIES.LIST, async (_event, rawQuery: unknown) => {
    const query = parseIpcArgs(IPC.CAPABILITIES.LIST, querySchema, rawQuery);
    const mindPath = query.mindId ? mindProvider.getMindPath(query.mindId) : undefined;
    if (query.mindId && !mindPath) {
      throw new Error(`Mind ${query.mindId} not found`);
    }
    return inventory.list(query, mindPath);
  });
}
