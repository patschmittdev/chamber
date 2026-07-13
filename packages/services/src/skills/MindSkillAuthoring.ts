import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SkillSaveResult, SkillSource } from '@chamber/shared/types';
import {
  isReservedSkillId,
  validateSkillFrontmatter,
  validateSkillId,
} from '@chamber/shared/skill-authoring';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { MAX_SKILL_MARKDOWN_BYTES } from './MindSkillDiscovery';

const SKILL_MARKDOWN_FILENAME = 'SKILL.md';
const MANAGED_SKILL_METADATA_FILENAME = '.chamber-skill.json';

/**
 * A single skill write. `id` selects the skill directory; `expectedMtimeMs` drives
 * optimistic concurrency: `null` requires a create (no existing SKILL.md), a number
 * requires the on-disk mtime to match before an update.
 */
export interface SkillWriteRequest {
  id: string;
  content: string;
  expectedMtimeMs: number | null;
}

/**
 * Creates and edits a mind's authored SKILL.md files.
 *
 * This service owns the write boundary for skills: it confines every path to the
 * owning mind's `.github/skills/<id>/SKILL.md`, rejects reserved core ids and
 * Chamber-managed skills, validates frontmatter before writing, and performs an
 * atomic tmp+rename with rollback. Read-only listing stays in MindSkillDiscovery;
 * managed-skill integrity stays in ManagedSkillService.
 */
export class MindSkillAuthoring {
  /**
   * Reads a skill's raw SKILL.md and mtime for editing. Returns empty content and a
   * null mtime when the skill has no SKILL.md yet, so a repair edit can create one.
   */
  async readSource(mindPath: string, id: string): Promise<SkillSource> {
    const idError = validateSkillId(id);
    if (idError) throw new Error(idError);

    const { skillFile } = resolveConfinedSkillFile(mindPath, id);
    if (!fs.existsSync(skillFile)) {
      return { id, content: '', mtimeMs: null };
    }

    const stat = fs.lstatSync(skillFile);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('SKILL.md is not a readable regular file.');
    }
    if (stat.size > MAX_SKILL_MARKDOWN_BYTES) {
      throw new Error('SKILL.md is too large to edit in Chamber.');
    }
    return { id, content: fs.readFileSync(skillFile, 'utf-8'), mtimeMs: stat.mtimeMs };
  }

  /**
   * Creates or updates a skill's SKILL.md. Never throws for expected rejections;
   * returns a failure result the renderer can surface inline.
   */
  async save(mindPath: string, request: SkillWriteRequest): Promise<SkillSaveResult> {
    const { id, content, expectedMtimeMs } = request;

    const idError = validateSkillId(id);
    if (idError) return fail(idError);
    if (isReservedSkillId(id)) return fail('Reserved core skills cannot be edited here.');
    if (!content.trim()) return fail('SKILL.md cannot be empty.');
    if (Buffer.byteLength(content, 'utf-8') > MAX_SKILL_MARKDOWN_BYTES) {
      return fail('SKILL.md is too large to save.');
    }
    const frontmatterError = validateSkillFrontmatter(content);
    if (frontmatterError) return fail(frontmatterError);

    let skillDir: string;
    let skillFile: string;
    try {
      ({ skillDir, skillFile } = resolveConfinedSkillFile(mindPath, id));
    } catch (error) {
      return fail(getErrorMessage(error));
    }

    if (fs.existsSync(path.join(skillDir, MANAGED_SKILL_METADATA_FILENAME))) {
      return fail('Chamber-managed skills cannot be edited here.');
    }
    if (fs.existsSync(skillFile) && fs.lstatSync(skillFile).isSymbolicLink()) {
      return fail('SKILL.md cannot be a symbolic link.');
    }

    const previousMtimeMs = statMtimeMs(skillFile);
    if (previousMtimeMs !== expectedMtimeMs) {
      return fail(
        expectedMtimeMs === null
          ? 'A skill with this id already exists.'
          : 'This skill changed on disk. Reload it before saving.',
      );
    }

    const previous = previousMtimeMs === null ? null : fs.readFileSync(skillFile, 'utf-8');
    const dirExisted = fs.existsSync(skillDir);
    const tmpPath = `${skillFile}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(tmpPath, content, 'utf-8');
      fs.renameSync(tmpPath, skillFile);
      return { success: true };
    } catch (error) {
      if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
      rollback(skillFile, skillDir, previous, dirExisted);
      return fail(getErrorMessage(error));
    }
  }
}

function fail(error: string): SkillSaveResult {
  return { success: false, error };
}

function resolveConfinedSkillFile(mindPath: string, id: string): { skillDir: string; skillFile: string } {
  const root = path.resolve(mindPath);
  const skillDir = path.join(root, '.github', 'skills', id);
  const skillFile = path.join(skillDir, SKILL_MARKDOWN_FILENAME);

  const relative = path.relative(root, skillFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Skill path escapes the mind directory.');
  }

  assertNoSymlinkSegments(root, relative);
  assertRealPathWithin(root, skillFile);
  return { skillDir, skillFile };
}

function assertNoSymlinkSegments(root: string, relative: string): void {
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error('Skill files cannot be symlinks.');
    }
  }
}

function assertRealPathWithin(root: string, skillFile: string): void {
  const realRoot = fs.realpathSync(root);
  let existing = skillFile;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return;
    existing = parent;
  }
  if (!isWithin(realRoot, fs.realpathSync(existing))) {
    throw new Error('Skill path resolves outside the mind directory.');
  }
}

function statMtimeMs(filePath: string): number | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.lstatSync(filePath).mtimeMs;
}

function rollback(skillFile: string, skillDir: string, previous: string | null, dirExisted: boolean): void {
  if (previous !== null) {
    fs.writeFileSync(skillFile, previous, 'utf-8');
    return;
  }
  if (fs.existsSync(skillFile)) fs.rmSync(skillFile, { force: true });
  if (!dirExisted && fs.existsSync(skillDir)) {
    try {
      fs.rmdirSync(skillDir);
    } catch {
      // A newly created directory that is no longer empty is left in place.
    }
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length === 0 ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}
