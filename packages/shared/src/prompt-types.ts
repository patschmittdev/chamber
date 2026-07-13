/**
 * User-authored prompt library types.
 *
 * Prompts are user-scoped reusable text, persisted in a dedicated store and
 * surfaced both in the composer slash menu and the Extensions management tab.
 * Values are user content and must always be rendered as text.
 */

/** A single saved prompt in the user's library. */
export interface Prompt {
  /** Opaque, app-minted stable identifier. */
  id: string;
  /** Short human label shown in the library and the slash menu. */
  title: string;
  /** The reusable prompt text inserted into the composer. */
  body: string;
  /** Optional short description shown as a hint. */
  description?: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-update timestamp. */
  updatedAt: string;
}

/**
 * Request to create or update a prompt. A null `id` creates a new prompt; a
 * string `id` updates the existing prompt with that id.
 */
export interface PromptSaveRequest {
  id: string | null;
  title: string;
  body: string;
  description?: string;
}

/**
 * Outcome of a prompt create, update, or delete. On success `prompts` carries
 * the refreshed library so the renderer can update without a second read; on
 * failure `error` is a user-facing message.
 */
export interface PromptMutationResult {
  success: boolean;
  error?: string;
  prompts?: Prompt[];
}
