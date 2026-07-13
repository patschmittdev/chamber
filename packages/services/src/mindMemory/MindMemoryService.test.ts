import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MindMemoryService, assertConfined } from './MindMemoryService';
import type { MindMemoryMindProvider } from './types';

const CAN_SYMLINK = canSymlink();

describe('MindMemoryService', () => {
  it('reads the three working-memory files with labels and content', () => {
    const { root, service } = createMemoryFixture();
    try {
      const memory = service.read('mind-1');

      expect(memory.mindId).toBe('mind-1');
      expect(memory.present).toBe(true);
      expect(memory.files.map((file) => file.name)).toEqual(['memory.md', 'rules.md', 'log.md']);
      expect(memory.files.map((file) => file.label)).toEqual(['Memory', 'Rules', 'Log']);

      const byName = Object.fromEntries(memory.files.map((file) => [file.name, file]));
      expect(byName['memory.md'].present).toBe(true);
      expect(byName['memory.md'].content).toBe('Remember the mission.');
      expect(byName['memory.md'].truncated).toBe(false);
      expect(byName['memory.md'].mtimeMs).toBeTypeOf('number');
      expect(byName['rules.md'].content).toBe('Stay in scope.');
      expect(byName['log.md'].content).toBe('Turn 1 complete.');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns a missing file as absent rather than throwing', () => {
    const { root, service } = createMemoryFixture();
    try {
      fs.rmSync(path.join(root, '.working-memory', 'rules.md'));

      const memory = service.read('mind-1');
      const rules = memory.files.find((file) => file.name === 'rules.md');

      expect(rules).toBeDefined();
      expect(rules?.present).toBe(false);
      expect(rules?.content).toBe('');
      expect(rules?.mtimeMs).toBeNull();
      expect(memory.present).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports the directory absent when there is no working memory', () => {
    const { root, service } = createMemoryFixture();
    try {
      fs.rmSync(path.join(root, '.working-memory'), { recursive: true, force: true });

      const memory = service.read('mind-1');

      expect(memory.present).toBe(false);
      expect(memory.files.every((file) => file.present === false)).toBe(true);
      expect(memory.files.every((file) => file.content === '')).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('bounds the bytes read and flags truncation for oversized files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-memory-'));
    try {
      fs.mkdirSync(path.join(root, '.working-memory'), { recursive: true });
      fs.writeFileSync(path.join(root, '.working-memory', 'memory.md'), 'A'.repeat(100));

      const service = new MindMemoryService(providerFor(root), 16);
      const memory = service.read('mind-1');
      const file = memory.files.find((entry) => entry.name === 'memory.md');

      expect(file?.present).toBe(true);
      expect(file?.truncated).toBe(true);
      expect(file?.content.length).toBe(16);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(!CAN_SYMLINK)('does not read through a symlink that escapes the working-memory directory', () => {
    const { root, service } = createMemoryFixture();
    const outside = path.join(os.tmpdir(), `chamber-memory-outside-${Date.now()}.md`);
    try {
      fs.writeFileSync(outside, 'SECRET OUTSIDE CONTENT');
      const linkPath = path.join(root, '.working-memory', 'memory.md');
      fs.rmSync(linkPath);
      fs.symlinkSync(outside, linkPath, 'file');

      const memory = service.read('mind-1');
      const file = memory.files.find((entry) => entry.name === 'memory.md');

      expect(file?.present).toBe(false);
      expect(file?.content).toBe('');
    } finally {
      fs.rmSync(outside, { force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws when the mind cannot be resolved', () => {
    const service = new MindMemoryService({ getMindPath: () => null });
    expect(() => service.read('missing')).toThrow(/not found/i);
  });
});

describe('assertConfined', () => {
  it('throws when the target escapes the mind root', () => {
    const root = path.join(os.tmpdir(), 'chamber-confine-root');
    const escaped = path.join(os.tmpdir(), 'chamber-confine-other', 'memory.md');
    expect(() => assertConfined(root, escaped)).toThrow(/escape/i);
  });

  it('does not throw for a path confined to the mind root', () => {
    const root = path.join(os.tmpdir(), 'chamber-confine-root');
    const confined = path.join(root, '.working-memory', 'memory.md');
    expect(() => assertConfined(root, confined)).not.toThrow();
  });
});

function providerFor(root: string): MindMemoryMindProvider {
  return { getMindPath: () => root };
}

function canSymlink(): boolean {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-symlink-probe-'));
  try {
    const target = path.join(dir, 'target.txt');
    const link = path.join(dir, 'link.txt');
    fs.writeFileSync(target, 'x');
    fs.symlinkSync(target, link, 'file');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function createMemoryFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-memory-'));
  fs.mkdirSync(path.join(root, '.working-memory'), { recursive: true });
  fs.writeFileSync(path.join(root, '.working-memory', 'memory.md'), 'Remember the mission.');
  fs.writeFileSync(path.join(root, '.working-memory', 'rules.md'), 'Stay in scope.');
  fs.writeFileSync(path.join(root, '.working-memory', 'log.md'), 'Turn 1 complete.');

  return { root, service: new MindMemoryService(providerFor(root)) };
}
