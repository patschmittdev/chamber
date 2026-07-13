import { describe, expect, it } from 'vitest';
import {
  buildSkillMarkdown,
  isReservedSkillId,
  parseSkillFrontmatter,
  validateSkillFrontmatter,
  validateSkillId,
} from './skill-authoring';

describe('validateSkillId', () => {
  for (const id of ['ship', 'issue-slate', 'a2a-relay', 'skill-creator', 'skill1']) {
    it(`accepts the safe kebab id ${id}`, () => {
      expect(validateSkillId(id)).toBeNull();
    });
  }

  for (const [label, id] of [
    ['empty', ''],
    ['uppercase', 'Ship'],
    ['underscore', 'my_skill'],
    ['space', 'my skill'],
    ['leading hyphen', '-skill'],
    ['trailing hyphen', 'skill-'],
    ['double hyphen', 'a--b'],
    ['path separator', 'a/b'],
    ['parent traversal', '..'],
    ['dot', 'a.b'],
  ] as const) {
    it(`rejects an id with ${label}`, () => {
      expect(validateSkillId(id)).toBeTruthy();
    });
  }

  it('rejects an id longer than the length bound', () => {
    expect(validateSkillId('a'.repeat(65))).toBeTruthy();
  });
});

describe('isReservedSkillId', () => {
  for (const id of ['lens', 'automation', 'ttasks']) {
    it(`treats the core id ${id} as reserved`, () => {
      expect(isReservedSkillId(id)).toBe(true);
    });
  }

  it('treats a normal id as not reserved', () => {
    expect(isReservedSkillId('my-skill')).toBe(false);
  });
});

describe('parseSkillFrontmatter', () => {
  it('returns null when there is no frontmatter block', () => {
    expect(parseSkillFrontmatter('# Just a heading\n')).toBeNull();
  });

  it('parses name, description, and version scalars', () => {
    const fields = parseSkillFrontmatter('---\nname: ship\ndescription: Ship it\nversion: 1.2.0\n---\n\n# ship\n');
    expect(fields).toEqual({ name: 'ship', description: 'Ship it', version: '1.2.0' });
  });

  it('strips wrapping quotes from values', () => {
    const fields = parseSkillFrontmatter('---\nname: "ship"\ndescription: \'Ship it\'\n---\n');
    expect(fields).toMatchObject({ name: 'ship', description: 'Ship it' });
  });

  it('tolerates a leading byte-order mark', () => {
    const fields = parseSkillFrontmatter('\uFEFF---\nname: ship\ndescription: Ship it\n---\n');
    expect(fields).toMatchObject({ name: 'ship', description: 'Ship it' });
  });

  it('folds indented continuation lines into the previous key', () => {
    const fields = parseSkillFrontmatter('---\nname: ship\ndescription: Ship it\n  across lines\n---\n');
    expect(fields?.description).toBe('Ship it across lines');
  });
});

describe('validateSkillFrontmatter', () => {
  it('accepts frontmatter with a name and description', () => {
    expect(validateSkillFrontmatter('---\nname: ship\ndescription: Ship it\n---\n\n# ship\n')).toBeNull();
  });

  it('accepts frontmatter that also declares a version', () => {
    expect(validateSkillFrontmatter('---\nname: ship\ndescription: Ship it\nversion: 0.1.0\n---\n')).toBeNull();
  });

  it('rejects content with no frontmatter block', () => {
    expect(validateSkillFrontmatter('# ship\n\nNo frontmatter here.')).toBeTruthy();
  });

  it('rejects frontmatter missing a name', () => {
    expect(validateSkillFrontmatter('---\ndescription: Ship it\n---\n')).toBeTruthy();
  });

  it('rejects frontmatter with an empty description', () => {
    expect(validateSkillFrontmatter('---\nname: ship\ndescription:   \n---\n')).toBeTruthy();
  });
});

describe('buildSkillMarkdown', () => {
  it('produces frontmatter that passes validation', () => {
    const content = buildSkillMarkdown({ name: 'my-skill', description: 'Does a thing.' });
    expect(validateSkillFrontmatter(content)).toBeNull();
  });

  it('includes the name in the frontmatter and as a heading', () => {
    const content = buildSkillMarkdown({ name: 'my-skill', description: 'Does a thing.' });
    expect(content).toContain('name: my-skill');
    expect(content).toContain('# my-skill');
  });

  it('collapses newlines in the description to keep a single-line scalar', () => {
    const content = buildSkillMarkdown({ name: 'my-skill', description: 'line one\nline two' });
    expect(content).toContain('description: line one line two');
    expect(validateSkillFrontmatter(content)).toBeNull();
  });
});
