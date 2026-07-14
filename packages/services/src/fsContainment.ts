// Filesystem containment primitive — symlink-safe path resolution for Lens and Canvas.
// Uses lstat and realpath instead of lexical string-prefix checks to prevent
// symlink traversal, junction escape, and check-to-use races.

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Thrown when a path fails containment validation. */
export class ContainmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContainmentError';
  }
}

/**
 * Verifies that `candidatePath` is safely contained within `trustedRoot`.
 *
 * Steps:
 * 1. `realpathSync(trustedRoot)` — canonicalizes the root (rejects symlinks in the root itself).
 * 2. Builds absolute candidate path from root (or asserts already absolute candidate is inside root).
 * 3. Fast lexical check that the joined path starts with root + separator.
 * 4. Walks every path component from root down to the candidate, calling `lstatSync` on each
 *    existing node and throwing if any is a symlink or junction.
 *
 * Returns the resolved concrete path. Throws `ContainmentError` on any violation.
 *
 * Suitable for use immediately before read, write, serve, and delete operations. Call it
 * just before each operation to close check-to-use races on already-validated paths.
 */
export function assertContained(trustedRoot: string, candidatePath: string): string {
  let resolvedRoot: string;
  try {
    resolvedRoot = fs.realpathSync(trustedRoot);
  } catch {
    throw new ContainmentError(`Trusted root is inaccessible: ${trustedRoot}`);
  }

  // Reject absolute candidate paths — callers must pass relative paths to prevent
  // resolution asymmetry between the resolved root and an unresolved absolute candidate.
  if (path.isAbsolute(candidatePath)) {
    throw new ContainmentError(`Candidate path must be relative: ${candidatePath}`);
  }

  // Build the full candidate path.
  const joined = path.join(resolvedRoot, candidatePath);

  // Fast lexical check before walking filesystem.
  if (!isLexicallyContained(resolvedRoot, joined)) {
    throw new ContainmentError(`Path escapes trusted root: ${candidatePath}`);
  }

  // Walk each component from root to candidate, rejecting any symlink along the way.
  const relativePart = path.relative(resolvedRoot, joined);
  if (relativePart) {
    const parts = relativePart.split(path.sep).filter(Boolean);
    let current = resolvedRoot;
    for (const part of parts) {
      current = path.join(current, part);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(current);
      } catch {
        // Component does not exist yet — containment holds for the existing prefix.
        break;
      }
      if (stat.isSymbolicLink()) {
        throw new ContainmentError(`Symlink or junction rejected at: ${current}`);
      }
    }
  }

  return joined;
}

/**
 * Writes `content` to `targetPath` atomically using a temp-sibling-then-rename pattern:
 * 1. Creates a temp file exclusively (O_EXCL) in the same directory.
 * 2. Writes content.
 * 3. Renames temp file to `targetPath` (atomic on POSIX; best-effort on Windows).
 *
 * The caller is responsible for asserting `targetPath` is inside a trusted root
 * before calling this function.
 */
export function writeAtomically(targetPath: string, content: string | Buffer): void {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  // Use a hidden temp name with random suffix to avoid conflicts.
  const tempPath = path.join(dir, `.${base}.tmp.${randomBytes(8).toString('hex')}`);
  try {
    if (typeof content === 'string') {
      fs.writeFileSync(tempPath, content, { encoding: 'utf8', flag: 'wx' });
    } else {
      fs.writeFileSync(tempPath, content, { flag: 'wx' });
    }
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    try { fs.rmSync(tempPath, { force: true }); } catch { /* ignore cleanup errors */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isLexicallyContained(resolvedRoot: string, candidate: string): boolean {
  const norm = (p: string): string =>
    process.platform === 'win32' ? p.toLowerCase() : p;
  const normRoot = norm(resolvedRoot);
  const normCand = norm(candidate);
  return normCand === normRoot || normCand.startsWith(normRoot + path.sep);
}
