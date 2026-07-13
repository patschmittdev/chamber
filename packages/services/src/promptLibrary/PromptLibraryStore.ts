import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Prompt } from '@chamber/shared/types';
import { MAX_PROMPTS, MAX_PROMPT_BODY_BYTES } from '@chamber/shared/prompt-authoring';

const PROMPTS_FILENAME = 'prompts.json';

/**
 * Safety envelope on the prompts file, in bytes: the largest a well-formed
 * library can be (every prompt at the maximum body size) plus per-record
 * overhead for titles, descriptions, timestamps, and JSON punctuation. A file
 * larger than this is treated as hostile or corrupt and read as empty rather
 * than loaded into memory.
 */
export const MAX_PROMPTS_FILE_BYTES = MAX_PROMPTS * (MAX_PROMPT_BODY_BYTES + 4096);

/**
 * Persists the user's prompt library to a single JSON file in the config
 * directory. This class owns the on-disk boundary: it confines the path to the
 * config directory, refuses to follow symlinks, bounds the bytes read, treats a
 * missing or malformed file as an empty library, and writes atomically via a
 * temporary file and rename so a crash mid-write cannot corrupt the library.
 */
export class PromptLibraryStore {
  private readonly file: string;

  constructor(
    private readonly configDir: string,
    private readonly maxFileBytes: number = MAX_PROMPTS_FILE_BYTES,
  ) {
    this.file = path.join(configDir, PROMPTS_FILENAME);
  }

  /**
   * Returns the stored library, or an empty array when the file is absent or
   * cannot be trusted (confinement failure, symlink, non-regular file, oversize,
   * or malformed JSON). This absent-not-error contract keeps the surface usable.
   *
   * KNOWN TRADE-OFF: because a present-but-unreadable file reads as empty, a
   * subsequent create (which is the only mutation that writes without a
   * matching-id guard) overwrites it via write(). The app's own atomic writes
   * never produce such a file and the create cap keeps a well-formed library
   * under the size bound, so this only arises from external tampering or a
   * hand-edit typo. Preserving a corrupt file as a sidecar before overwrite is a
   * documented follow-up, deliberately deferred to keep this change surgical.
   */
  read(): Prompt[] {
    try {
      if (!fs.existsSync(this.file)) return [];
      assertPromptsPathConfined(this.configDir, this.file);
      const stat = fs.lstatSync(this.file);
      if (stat.isSymbolicLink() || !stat.isFile()) return [];
      if (stat.size > this.maxFileBytes) return [];
      return parsePrompts(fs.readFileSync(this.file, 'utf-8'));
    } catch {
      // Absent-not-error: any confinement, read, or parse failure degrades to an
      // empty library so the surface stays usable instead of surfacing a raw error.
      return [];
    }
  }

  write(prompts: Prompt[]): void {
    fs.mkdirSync(this.configDir, { recursive: true });
    assertPromptsPathConfined(this.configDir, this.file);

    const tmpPath = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(prompts, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.file);
    } catch (error) {
      if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
      throw error;
    }
  }
}

function parsePrompts(raw: string): Prompt[] {
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) return [];
  return data.filter(isPrompt);
}

function isPrompt(value: unknown): value is Prompt {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.body === 'string' &&
    (record.description === undefined || typeof record.description === 'string') &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string'
  );
}

/**
 * Ensures `file` stays within `configDir` and that no segment between the two is
 * a symlink, mirroring the working-memory and skill path guards. Throws
 * otherwise. Exported so the confinement logic can be unit-tested without
 * symlink privileges on the host platform.
 */
export function assertPromptsPathConfined(configDir: string, file: string): void {
  const root = path.resolve(configDir);
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Prompt library path escapes the config directory.');
  }

  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('Prompt library path cannot traverse a symbolic link.');
    }
  }
}
