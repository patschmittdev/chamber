import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC, parseIpcArgs } from '@chamber/shared';
import type { Prompt, PromptMutationResult, PromptSaveRequest } from '@chamber/shared/types';

const saveRequestSchema = z.object({
  id: z.string().min(1, 'must be a non-empty string').nullable(),
  title: z.string(),
  body: z.string(),
  description: z.string().optional(),
});

const promptIdSchema = z.string().min(1, 'must be a non-empty string');

/**
 * The service surface the adapter delegates to. Declared here so the adapter can
 * be tested against a fake and stays decoupled from the concrete service.
 */
export interface PromptLibraryServicePort {
  list(): Prompt[];
  save(request: PromptSaveRequest): PromptMutationResult;
  delete(id: string): PromptMutationResult;
}

/**
 * Thin, user-scoped IPC adapter for the prompt library. It validates payloads at
 * the trust boundary and delegates to the service; it holds no business logic.
 */
export function setupPromptsIPC(service: PromptLibraryServicePort): void {
  ipcMain.handle(IPC.PROMPTS.LIST, async () => service.list());

  ipcMain.handle(IPC.PROMPTS.SAVE, async (_event, rawRequest: unknown) => {
    const request = parseIpcArgs(IPC.PROMPTS.SAVE, saveRequestSchema, rawRequest);
    return service.save(request);
  });

  ipcMain.handle(IPC.PROMPTS.DELETE, async (_event, rawId: unknown) => {
    const id = parseIpcArgs(IPC.PROMPTS.DELETE, promptIdSchema, rawId);
    return service.delete(id);
  });
}
