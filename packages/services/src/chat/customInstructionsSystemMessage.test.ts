import { describe, it, expect } from 'vitest';
import { buildCustomInstructionsSection } from './customInstructionsSystemMessage';

describe('buildCustomInstructionsSection', () => {
  it('returns null for empty instructions', () => {
    expect(buildCustomInstructionsSection('')).toBeNull();
  });

  it('returns null for whitespace-only instructions', () => {
    expect(buildCustomInstructionsSection('   \n\t  ')).toBeNull();
  });

  it('renders a delimited Custom Instructions section for real instructions', () => {
    const section = buildCustomInstructionsSection('Prefer TypeScript examples.');
    expect(section).toContain('## Custom Instructions');
    expect(section).toContain('Prefer TypeScript examples.');
  });

  it('trims surrounding whitespace from the instructions', () => {
    const section = buildCustomInstructionsSection('  Be concise.  ');
    expect(section).toContain('\nBe concise.');
    expect(section?.endsWith('Be concise.')).toBe(true);
  });
});
