/**
 * Pure, browser-safe helpers for authoring a skill's SKILL.md.
 *
 * These functions are shared by the renderer (create form and pre-submit UX) and
 * the authoring service (authoritative pre-write validation). They perform no
 * filesystem or process access; on-disk path confinement stays in the service.
 */

/** Skill directory ids are single kebab-case segments, for example `issue-slate`. */
export const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Upper bound on a skill id length; keeps directory names sane across platforms. */
export const MAX_SKILL_ID_LENGTH = 64;

/**
 * Core skill ids Chamber manages. Authoring must never create or overwrite them;
 * their integrity and lifecycle remain owned by ManagedSkillService.
 */
export const RESERVED_SKILL_IDS = ['lens', 'automation', 'ttasks'] as const;

/** Reports whether an id collides with a Chamber-managed core skill. */
export function isReservedSkillId(id: string): boolean {
  return (RESERVED_SKILL_IDS as readonly string[]).includes(id);
}

/**
 * Validates a skill directory id for syntax only. Returns a user-facing error
 * message, or null when the id is a safe single kebab-case segment.
 */
export function validateSkillId(id: string): string | null {
  if (!id) return 'Skill id is required.';
  if (id.length > MAX_SKILL_ID_LENGTH) {
    return `Skill id must be at most ${MAX_SKILL_ID_LENGTH} characters.`;
  }
  if (!SKILL_ID_PATTERN.test(id)) {
    return 'Skill id must be lowercase letters, numbers, and single hyphens (for example my-skill).';
  }
  return null;
}

/**
 * Parses the bounded scalar subset of SKILL.md frontmatter into a flat map, or
 * null when the content has no leading `---` block. Indented lines fold into the
 * previous key so wrapped descriptions round-trip.
 */
export function parseSkillFrontmatter(raw: string): Record<string, string> | null {
  const content = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const fields = new Map<string, string>();
  let currentKey: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (currentKey && /^\s+\S/.test(line)) {
      fields.set(currentKey, `${fields.get(currentKey) ?? ''} ${line.trim()}`);
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!kv) {
      currentKey = null;
      continue;
    }
    currentKey = kv[1];
    fields.set(currentKey, kv[2].trim());
  }

  const record: Record<string, string> = {};
  for (const [key, value] of fields) record[key] = stripQuotes(value);
  return record;
}

/**
 * Validates SKILL.md frontmatter before a write. Returns a user-facing error
 * message, or null when the required `name` and `description` fields are present.
 */
export function validateSkillFrontmatter(content: string): string | null {
  const fields = parseSkillFrontmatter(content);
  if (!fields) return 'SKILL.md must begin with a --- frontmatter block.';
  if (!fields.name || !fields.name.trim()) {
    return 'Skill frontmatter must include a non-empty name.';
  }
  if (!fields.description || !fields.description.trim()) {
    return 'Skill frontmatter must include a non-empty description.';
  }
  return null;
}

/**
 * Builds a starter SKILL.md from a name and description. Values are collapsed to
 * single-line scalars so the generated frontmatter always parses and validates.
 */
export function buildSkillMarkdown({ name, description }: { name: string; description: string }): string {
  const safeName = collapseWhitespace(name);
  const safeDescription = collapseWhitespace(description);
  return [
    '---',
    `name: ${safeName}`,
    `description: ${safeDescription}`,
    '---',
    '',
    `# ${safeName}`,
    '',
    'Describe when this skill should be used and what it does.',
    '',
    '## Instructions',
    '',
    'Add step-by-step guidance for the agent here.',
    '',
  ].join('\n');
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
