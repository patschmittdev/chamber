import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Prompt } from '@chamber/shared/types';
import { PromptLibraryStore, assertPromptsPathConfined } from './PromptLibraryStore';

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: overrides.id ?? randomUUID(),
    title: overrides.title ?? 'Standup',
    body: overrides.body ?? 'Summarize my day.',
    ...(overrides.description !== undefined ? { description: overrides.description } : {}),
    createdAt: overrides.createdAt ?? '2024-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2024-01-01T00:00:00.000Z',
  };
}

describe('PromptLibraryStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-prompts-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty library when the file is absent', () => {
    expect(new PromptLibraryStore(dir).read()).toEqual([]);
  });

  it('round-trips prompts through write then read', () => {
    const store = new PromptLibraryStore(dir);
    const prompts = [makePrompt({ id: 'a' }), makePrompt({ id: 'b', description: 'Daily' })];
    store.write(prompts);
    expect(store.read()).toEqual(prompts);
  });

  it('creates the config directory on first write', () => {
    const nested = path.join(dir, 'nested', 'chamber');
    const store = new PromptLibraryStore(nested);
    store.write([makePrompt({ id: 'a' })]);
    expect(fs.existsSync(path.join(nested, 'prompts.json'))).toBe(true);
  });

  it('leaves no temporary file behind after an atomic write', () => {
    const store = new PromptLibraryStore(dir);
    store.write([makePrompt({ id: 'a' })]);
    const leftovers = fs.readdirSync(dir).filter((name) => name.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('returns an empty library when the file exceeds the size bound', () => {
    const store = new PromptLibraryStore(dir, 64);
    fs.writeFileSync(path.join(dir, 'prompts.json'), JSON.stringify([makePrompt({ body: 'x'.repeat(500) })]));
    expect(store.read()).toEqual([]);
  });

  it('returns an empty library for malformed JSON', () => {
    fs.writeFileSync(path.join(dir, 'prompts.json'), '{ not json');
    expect(new PromptLibraryStore(dir).read()).toEqual([]);
  });

  it('returns an empty library when the top-level value is not an array', () => {
    fs.writeFileSync(path.join(dir, 'prompts.json'), JSON.stringify({ id: 'a' }));
    expect(new PromptLibraryStore(dir).read()).toEqual([]);
  });

  it('drops malformed records while keeping well-formed ones', () => {
    const good = makePrompt({ id: 'good' });
    fs.writeFileSync(
      path.join(dir, 'prompts.json'),
      JSON.stringify([good, { id: 'bad' }, 42, null]),
    );
    expect(new PromptLibraryStore(dir).read()).toEqual([good]);
  });

  it('rejects a path that escapes the config directory', () => {
    expect(() => assertPromptsPathConfined(dir, path.join(dir, '..', 'prompts.json'))).toThrow();
  });

  it('accepts the canonical prompts file inside the config directory', () => {
    expect(() => assertPromptsPathConfined(dir, path.join(dir, 'prompts.json'))).not.toThrow();
  });

  it.skipIf(!CAN_SYMLINK)('rejects a prompts file reached through a symlink', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-prompts-outside-'));
    const link = path.join(dir, 'prompts.json');
    try {
      fs.writeFileSync(path.join(outside, 'prompts.json'), '[]');
      fs.symlinkSync(path.join(outside, 'prompts.json'), link, 'file');
      expect(() => assertPromptsPathConfined(dir, link)).toThrow(/symbolic link/i);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

function canSymlink(): boolean {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-prompts-symlink-probe-'));
  try {
    const target = path.join(probe, 'target.txt');
    const link = path.join(probe, 'link.txt');
    fs.writeFileSync(target, 'x');
    fs.symlinkSync(target, link, 'file');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
}

const CAN_SYMLINK = canSymlink();
