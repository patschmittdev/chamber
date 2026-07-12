/**
 * Renders a `## Custom Instructions` markdown section carrying the operator's
 * global instructions that apply to every mind. Returns null when the operator
 * has not set any instructions so callers can skip appending an empty section.
 *
 * These are user-authored, cross-cutting preferences (like ChatGPT/Claude
 * custom instructions). Each mind still owns its personality through SOUL.md;
 * this section layers the operator's global guidance on top without requiring
 * per-mind edits.
 */
export function buildCustomInstructionsSection(instructions: string): string | null {
  const trimmed = instructions.trim();
  if (trimmed.length === 0) return null;
  return [
    '## Custom Instructions',
    '',
    'The operator set these global instructions for every mind in Chamber. Follow them alongside your own identity, unless they conflict with Chamber safety rules.',
    '',
    trimmed,
  ].join('\n');
}
