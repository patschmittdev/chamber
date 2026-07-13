import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  MindWorkingMemory,
  MindWorkingMemoryFile,
  MindWorkingMemoryFileName,
} from '@chamber/shared/types';
import type { MindMemoryMindProvider } from './types';

const WORKING_MEMORY_DIR = '.working-memory';

/** Canonical files, in the order the agent runtime composes them. */
const WORKING_MEMORY_FILES: readonly MindWorkingMemoryFileName[] = ['memory.md', 'rules.md', 'log.md'];

const FILE_LABELS: Record<MindWorkingMemoryFileName, string> = {
  'memory.md': 'Memory',
  'rules.md': 'Rules',
  'log.md': 'Log',
};

/** Upper bound on bytes read per file so a runaway log cannot exhaust memory. */
const MAX_WORKING_MEMORY_BYTES = 256_000;

/**
 * Read-only reader for a mind's agent-managed working memory. Working memory is
 * owned by the agent, so this service never writes: it only surfaces the three
 * `.working-memory/` files for display. Reads are confined to the resolved mind
 * directory, reject symlink escapes, bound the bytes read, and treat missing
 * files as absent rather than errors.
 */
export class MindMemoryService {
  constructor(
    private readonly minds: MindMemoryMindProvider,
    private readonly maxContentBytes: number = MAX_WORKING_MEMORY_BYTES,
  ) {}

  read(mindId: string): MindWorkingMemory {
    const mindRoot = this.requireMindPath(mindId);
    const memoryDir = path.join(mindRoot, WORKING_MEMORY_DIR);
    const present = this.isConfinedDirectory(mindRoot, memoryDir);
    const files = WORKING_MEMORY_FILES.map((name) => this.readFile(mindRoot, memoryDir, name));
    return { mindId, present, files };
  }

  private requireMindPath(mindId: string): string {
    const mindPath = this.minds.getMindPath(mindId);
    if (!mindPath) throw new Error(`Mind ${mindId} not found`);
    return path.resolve(mindPath);
  }

  private readFile(mindRoot: string, memoryDir: string, name: MindWorkingMemoryFileName): MindWorkingMemoryFile {
    const absent: MindWorkingMemoryFile = {
      name,
      label: FILE_LABELS[name],
      present: false,
      content: '',
      truncated: false,
      mtimeMs: null,
    };

    try {
      const filePath = path.join(memoryDir, name);
      if (!fs.existsSync(filePath)) return absent;
      assertConfined(mindRoot, filePath);
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile()) return absent;

      const { content, truncated } = readBounded(filePath, stat.size, this.maxContentBytes);
      return {
        name,
        label: FILE_LABELS[name],
        present: true,
        content,
        truncated,
        mtimeMs: stat.mtimeMs,
      };
    } catch {
      // Absent-not-error: any confinement or read failure degrades to absent so
      // the viewer stays informative instead of surfacing a raw error.
      return absent;
    }
  }

  private isConfinedDirectory(mindRoot: string, memoryDir: string): boolean {
    try {
      if (!fs.existsSync(memoryDir)) return false;
      assertConfined(mindRoot, memoryDir);
      return fs.lstatSync(memoryDir).isDirectory();
    } catch {
      return false;
    }
  }
}

/**
 * Reads up to `maxBytes` from `filePath` without loading more than the cap into
 * memory, reporting whether the file was larger than the cap.
 */
function readBounded(filePath: string, size: number, maxBytes: number): { content: string; truncated: boolean } {
  const fd = fs.openSync(filePath, 'r');
  try {
    const readCap = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(readCap);
    const bytesRead = fs.readSync(fd, buffer, 0, readCap, 0);
    return {
      content: buffer.subarray(0, bytesRead).toString('utf-8'),
      truncated: size > maxBytes,
    };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Ensures `targetPath` stays within `mindRoot` and that no segment between the
 * two is a symlink, mirroring the profile-editor path guard. Throws otherwise.
 * Exported so the confinement logic can be unit-tested without symlink
 * privileges on the host platform.
 */
export function assertConfined(mindRoot: string, targetPath: string): void {
  const root = path.resolve(mindRoot);
  const relative = path.relative(root, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Working-memory path escapes the mind directory.');
  }

  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('Working-memory files cannot be symlinks.');
    }
  }
}
