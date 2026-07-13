/**
 * Pure, browser-safe helpers for validating a user-authored prompt.
 *
 * Shared by the renderer (pre-submit UX) and the host service (authoritative
 * pre-write validation). These functions perform no filesystem or process
 * access; persistence and on-disk path confinement stay in PromptLibraryStore.
 */

/** Upper bound on a prompt title, in characters. */
export const MAX_PROMPT_TITLE_LENGTH = 200;

/** Upper bound on a prompt description, in characters. */
export const MAX_PROMPT_DESCRIPTION_LENGTH = 500;

/** Upper bound on a prompt body, in UTF-8 bytes. */
export const MAX_PROMPT_BODY_BYTES = 32 * 1024;

/** Upper bound on how many prompts the library retains. */
export const MAX_PROMPTS = 500;

/** The user-authored fields of a prompt, before ids and timestamps are minted. */
export interface PromptInput {
  title: string;
  body: string;
  description?: string;
}

/** Counts UTF-8 bytes using TextEncoder, which exists in both Node and browsers. */
function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Validates prompt fields for presence and bounds only. Returns a user-facing
 * error message, or null when the input is a safe prompt. Whitespace-only
 * values are treated as empty.
 */
export function validatePromptInput(input: PromptInput): string | null {
  const title = input.title.trim();
  const body = input.body.trim();
  const description = input.description?.trim() ?? '';

  if (!title) return 'Title is required.';
  if (title.length > MAX_PROMPT_TITLE_LENGTH) {
    return `Title must be at most ${MAX_PROMPT_TITLE_LENGTH} characters.`;
  }
  if (!body) return 'Prompt body is required.';
  if (utf8ByteLength(body) > MAX_PROMPT_BODY_BYTES) {
    return 'Prompt body is too large to save.';
  }
  if (description.length > MAX_PROMPT_DESCRIPTION_LENGTH) {
    return `Description must be at most ${MAX_PROMPT_DESCRIPTION_LENGTH} characters.`;
  }
  return null;
}
