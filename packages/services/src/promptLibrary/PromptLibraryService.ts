import { randomUUID } from 'node:crypto';
import type { Prompt, PromptMutationResult, PromptSaveRequest } from '@chamber/shared/types';
import { MAX_PROMPTS, validatePromptInput } from '@chamber/shared/prompt-authoring';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';

/**
 * The persistence surface the service depends on. Declared here so the service
 * can be unit-tested against an in-memory fake and stays decoupled from the
 * filesystem-backed PromptLibraryStore.
 */
export interface PromptLibraryStorePort {
  read(): Prompt[];
  write(prompts: Prompt[]): void;
}

/**
 * Owns prompt-library CRUD: validation, id and timestamp minting, the
 * maximum-count guard, and returning the refreshed library after every
 * mutation. Persistence and path confinement stay in PromptLibraryStore.
 */
export class PromptLibraryService {
  constructor(
    private readonly store: PromptLibraryStorePort,
    private readonly newId: () => string = randomUUID,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): Prompt[] {
    return this.store.read();
  }

  save(request: PromptSaveRequest): PromptMutationResult {
    const error = validatePromptInput(request);
    if (error) return { success: false, error };

    const title = request.title.trim();
    const body = request.body.trim();
    const description = request.description?.trim();
    const prompts = this.store.read();

    if (request.id === null) {
      if (prompts.length >= MAX_PROMPTS) {
        return { success: false, error: `You can save at most ${MAX_PROMPTS} prompts.` };
      }
      const timestamp = this.now().toISOString();
      const created: Prompt = {
        id: this.newId(),
        title,
        body,
        ...(description ? { description } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      return this.persist([...prompts, created]);
    }

    const index = prompts.findIndex((prompt) => prompt.id === request.id);
    if (index === -1) return { success: false, error: 'Prompt not found.' };

    const existing = prompts[index];
    const updated: Prompt = {
      id: existing.id,
      title,
      body,
      ...(description ? { description } : {}),
      createdAt: existing.createdAt,
      updatedAt: this.now().toISOString(),
    };
    return this.persist(prompts.map((prompt, i) => (i === index ? updated : prompt)));
  }

  delete(id: string): PromptMutationResult {
    const prompts = this.store.read();
    const next = prompts.filter((prompt) => prompt.id !== id);
    if (next.length === prompts.length) return { success: false, error: 'Prompt not found.' };
    return this.persist(next);
  }

  private persist(prompts: Prompt[]): PromptMutationResult {
    try {
      this.store.write(prompts);
      return { success: true, prompts };
    } catch (error) {
      // The store owns the on-disk boundary and can fail on IO (permissions,
      // disk full, a rename racing another process). Return the typed failure
      // the contract already carries rather than throwing raw filesystem
      // wording across IPC, mirroring MindSkillAuthoring.
      return { success: false, error: getErrorMessage(error) };
    }
  }
}
