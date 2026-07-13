import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MindSkillAuthoring } from './MindSkillAuthoring';

describe('MindSkillAuthoring', () => {
  let tmp: string;
  let outsidePath: string;
  let mindPath: string;
  let skillsDir: string;
  const authoring = new MindSkillAuthoring();

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-skill-write-'));
    outsidePath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-skill-write-outside-'));
    mindPath = tmp;
    skillsDir = path.join(mindPath, '.github', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(outsidePath, { recursive: true, force: true });
  });

  function writeSkill(id: string, content: string): void {
    const dir = path.join(skillsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
  }

  function readSkill(id: string): string {
    return fs.readFileSync(path.join(skillsDir, id, 'SKILL.md'), 'utf-8');
  }

  const valid = '---\nname: helper\ndescription: Helps out.\n---\n\n# helper\n\nBody.\n';

  describe('readSource', () => {
    it('reads SKILL.md content and mtime for an existing skill', async () => {
      writeSkill('helper', valid);
      const source = await authoring.readSource(mindPath, 'helper');
      expect(source.id).toBe('helper');
      expect(source.content).toBe(valid);
      expect(typeof source.mtimeMs).toBe('number');
    });

    it('returns empty content and null mtime when the skill has no SKILL.md', async () => {
      const source = await authoring.readSource(mindPath, 'ghost');
      expect(source).toEqual({ id: 'ghost', content: '', mtimeMs: null });
    });

    it('rejects an invalid id', async () => {
      await expect(authoring.readSource(mindPath, 'Bad Id')).rejects.toThrow();
    });
  });

  describe('save creating a new skill', () => {
    it('creates the skill directory and SKILL.md', async () => {
      const result = await authoring.save(mindPath, { id: 'fresh', content: valid, expectedMtimeMs: null });
      expect(result).toEqual({ success: true });
      expect(readSkill('fresh')).toBe(valid);
    });

    it('rejects when a skill with the id already exists', async () => {
      writeSkill('taken', valid);
      const result = await authoring.save(mindPath, { id: 'taken', content: valid, expectedMtimeMs: null });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already exists/i);
    });

    it('rejects a reserved core id', async () => {
      const result = await authoring.save(mindPath, { id: 'lens', content: valid, expectedMtimeMs: null });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/reserved/i);
      expect(fs.existsSync(path.join(skillsDir, 'lens'))).toBe(false);
    });

    it('rejects an invalid id without touching disk', async () => {
      const result = await authoring.save(mindPath, { id: 'Bad Id', content: valid, expectedMtimeMs: null });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('rejects content whose frontmatter is missing a description', async () => {
      const content = '---\nname: helper\n---\n\n# helper\n';
      const result = await authoring.save(mindPath, { id: 'nodesc', content, expectedMtimeMs: null });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/description/i);
      expect(fs.existsSync(path.join(skillsDir, 'nodesc'))).toBe(false);
    });

    it('rejects content with no frontmatter block', async () => {
      const result = await authoring.save(mindPath, { id: 'nofm', content: '# helper\n', expectedMtimeMs: null });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/frontmatter/i);
    });
  });

  describe('save updating an existing skill', () => {
    it('updates SKILL.md when the mtime matches', async () => {
      writeSkill('helper', valid);
      const { mtimeMs } = await authoring.readSource(mindPath, 'helper');
      const next = '---\nname: helper\ndescription: Helps more.\n---\n\n# helper\n\nNew body.\n';
      const result = await authoring.save(mindPath, { id: 'helper', content: next, expectedMtimeMs: mtimeMs });
      expect(result).toEqual({ success: true });
      expect(readSkill('helper')).toBe(next);
    });

    it('rejects a stale write when the mtime does not match', async () => {
      writeSkill('helper', valid);
      const result = await authoring.save(mindPath, { id: 'helper', content: valid, expectedMtimeMs: 1 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/changed on disk/i);
    });

    it('rejects editing a Chamber-managed skill', async () => {
      writeSkill('managed', valid);
      fs.writeFileSync(path.join(skillsDir, 'managed', '.chamber-skill.json'), '{"managedBy":"chamber"}', 'utf-8');
      const { mtimeMs } = await authoring.readSource(mindPath, 'managed');
      const result = await authoring.save(mindPath, { id: 'managed', content: valid, expectedMtimeMs: mtimeMs });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/managed/i);
    });
  });

  it.skipIf(process.platform === 'win32')('rejects saving through a POSIX symlink that escapes the mind', async () => {
    fs.symlinkSync(outsidePath, path.join(skillsDir, 'linked'), 'dir');
    const result = await authoring.save(mindPath, { id: 'linked', content: valid, expectedMtimeMs: null });
    expect(result.success).toBe(false);
    expect(fs.existsSync(path.join(outsidePath, 'SKILL.md'))).toBe(false);
  });

  it.skipIf(process.platform !== 'win32')('rejects saving through a Windows junction that escapes the mind', async () => {
    fs.symlinkSync(outsidePath, path.join(skillsDir, 'linked'), 'junction');
    const result = await authoring.save(mindPath, { id: 'linked', content: valid, expectedMtimeMs: null });
    expect(result.success).toBe(false);
    expect(fs.existsSync(path.join(outsidePath, 'SKILL.md'))).toBe(false);
  });
});
