// @vitest-environment node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertContained, ContainmentError, writeAtomically } from './fsContainment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-containment-'));
  tempDirs.push(dir);
  return dir;
}

function tryCreateSymlink(target: string, linkPath: string): boolean {
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch {
    // Windows may require elevation or Developer Mode for symlinks.
    return false;
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// assertContained — basic containment
// ---------------------------------------------------------------------------

describe('assertContained', () => {
  describe('relative candidate paths', () => {
    it('returns the full path for a simple relative candidate inside root', () => {
      const root = makeTempDir();
      const result = assertContained(root, 'child.txt');
      expect(result).toBe(path.join(root, 'child.txt'));
    });

    it('returns a deeply nested path when all components exist and are real', () => {
      const root = makeTempDir();
      const nested = path.join(root, 'a', 'b');
      fs.mkdirSync(nested, { recursive: true });
      const result = assertContained(root, path.join('a', 'b', 'file.json'));
      expect(result).toBe(path.join(root, 'a', 'b', 'file.json'));
    });

    it('succeeds when nested path does not exist yet (destination write scenario)', () => {
      const root = makeTempDir();
      // None of these directories exist — should still pass containment.
      const result = assertContained(root, path.join('new', 'dir', 'file.html'));
      expect(result).toBe(path.join(root, 'new', 'dir', 'file.html'));
    });
  });

  describe('traversal rejection', () => {
    it('rejects a relative path with .. segments', () => {
      const root = makeTempDir();
      expect(() => assertContained(root, '../escape.txt')).toThrow(ContainmentError);
    });

    it('rejects a deeply nested traversal attempt', () => {
      const root = makeTempDir();
      fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
      expect(() => assertContained(root, path.join('sub', '..', '..', 'up.txt'))).toThrow(ContainmentError);
    });

    it('rejects an absolute candidate regardless of whether it is inside the root', () => {
      const root = makeTempDir();
      const outside = path.join(root, '..', 'other');
      expect(() => assertContained(root, outside)).toThrow(ContainmentError);
    });

    it('rejects an absolute candidate that is inside the root', () => {
      const root = makeTempDir();
      const inside = path.join(root, 'child.txt');
      // Callers must pass relative paths; absolute candidates are always rejected.
      expect(() => assertContained(root, inside)).toThrow(ContainmentError);
    });
  });

  describe('symlink rejection — source file', () => {
    it('rejects a symlink file inside the root', () => {
      const root = makeTempDir();
      const realFile = path.join(root, 'real.txt');
      fs.writeFileSync(realFile, 'content');
      const linkPath = path.join(root, 'link.txt');
      const canCreate = tryCreateSymlink(realFile, linkPath);
      if (!canCreate) return; // Skip on platforms where symlinks require elevation.

      expect(() => assertContained(root, 'link.txt')).toThrow(ContainmentError);
    });

    it('rejects a symlink that points outside the root', () => {
      const root = makeTempDir();
      const outside = os.tmpdir();
      const linkPath = path.join(root, 'escape-link');
      const canCreate = tryCreateSymlink(outside, linkPath);
      if (!canCreate) return;

      expect(() => assertContained(root, 'escape-link')).toThrow(ContainmentError);
    });
  });

  describe('symlink rejection — ancestor directory', () => {
    it('rejects a path whose ancestor directory inside the root is a symlink', () => {
      const root = makeTempDir();
      const realDir = makeTempDir(); // Outside the root.
      const linkDir = path.join(root, 'linked-dir');
      const canCreate = tryCreateSymlink(realDir, linkDir);
      if (!canCreate) return;

      expect(() => assertContained(root, path.join('linked-dir', 'file.txt'))).toThrow(ContainmentError);
    });
  });

  describe('inaccessible root', () => {
    it('throws ContainmentError when the root does not exist', () => {
      const nonExistent = path.join(os.tmpdir(), 'does-not-exist-' + Math.random());
      expect(() => assertContained(nonExistent, 'file.txt')).toThrow(ContainmentError);
    });
  });

  describe('race resistance — replacement after validation', () => {
    it('detects a symlink installed between first and second assertContained call', () => {
      const root = makeTempDir();
      const target = path.join(root, 'child.txt');

      // First call passes (no symlink yet).
      assertContained(root, 'child.txt');

      // Attacker replaces child.txt with a symlink after initial check.
      const outside = os.tmpdir();
      const canCreate = tryCreateSymlink(outside, target);
      if (!canCreate) return;

      // Second call (revalidation before write) should now fail.
      expect(() => assertContained(root, 'child.txt')).toThrow(ContainmentError);
    });
  });
});

// ---------------------------------------------------------------------------
// writeAtomically
// ---------------------------------------------------------------------------

describe('writeAtomically', () => {
  it('writes string content to the target file', () => {
    const root = makeTempDir();
    const target = path.join(root, 'output.html');
    writeAtomically(target, '<html>Hello</html>');
    expect(fs.readFileSync(target, 'utf8')).toBe('<html>Hello</html>');
  });

  it('writes Buffer content to the target file', () => {
    const root = makeTempDir();
    const target = path.join(root, 'output.bin');
    const buf = Buffer.from([1, 2, 3]);
    writeAtomically(target, buf);
    expect(fs.readFileSync(target)).toEqual(buf);
  });

  it('atomically replaces an existing file', () => {
    const root = makeTempDir();
    const target = path.join(root, 'data.json');
    fs.writeFileSync(target, '{"v":1}');
    writeAtomically(target, '{"v":2}');
    expect(fs.readFileSync(target, 'utf8')).toBe('{"v":2}');
  });

  it('leaves no temp file if write fails', () => {
    const root = makeTempDir();
    // Provide a target whose parent directory does not exist — write will fail.
    const target = path.join(root, 'no-such-dir', 'output.html');
    expect(() => writeAtomically(target, 'content')).toThrow();
    // No temp files should remain in root.
    const entries = fs.readdirSync(root);
    const temps = entries.filter(e => e.includes('.tmp.'));
    expect(temps).toHaveLength(0);
  });

  describe('storage stays under the provided root', () => {
    it('temp file is created in the same directory as target', () => {
      const root = makeTempDir();
      const target = path.join(root, 'report.html');
      // Intercept to observe temp file existence during write (not easily testable),
      // so just verify final state: only the target file present.
      writeAtomically(target, '<html>Report</html>');
      const entries = fs.readdirSync(root);
      // After successful write only the target should remain (no leftover temp).
      expect(entries).toEqual(['report.html']);
    });
  });
});
