import { describe, it, expect } from 'vitest';
import {
  MAX_PROMPT_BODY_BYTES,
  MAX_PROMPT_DESCRIPTION_LENGTH,
  MAX_PROMPT_TITLE_LENGTH,
  validatePromptInput,
} from './prompt-authoring';

describe('validatePromptInput', () => {
  it('accepts a well-formed prompt', () => {
    expect(validatePromptInput({ title: 'Standup', body: 'Summarize my day.', description: 'Daily' })).toBeNull();
  });

  it('accepts a prompt without a description', () => {
    expect(validatePromptInput({ title: 'Standup', body: 'Summarize my day.' })).toBeNull();
  });

  it('requires a non-empty title', () => {
    expect(validatePromptInput({ title: '   ', body: 'x' })).toBe('Title is required.');
  });

  it('requires a non-empty body', () => {
    expect(validatePromptInput({ title: 'Standup', body: '   ' })).toBe('Prompt body is required.');
  });

  it('rejects a title longer than the bound', () => {
    const title = 'a'.repeat(MAX_PROMPT_TITLE_LENGTH + 1);
    expect(validatePromptInput({ title, body: 'x' })).toBe(
      `Title must be at most ${MAX_PROMPT_TITLE_LENGTH} characters.`,
    );
  });

  it('rejects a body larger than the byte bound', () => {
    const body = 'a'.repeat(MAX_PROMPT_BODY_BYTES + 1);
    expect(validatePromptInput({ title: 'Standup', body })).toBe('Prompt body is too large to save.');
  });

  it('counts body size in UTF-8 bytes, not characters', () => {
    // A 2-byte character repeated just over half the byte cap exceeds it.
    const body = 'e\u0301'.repeat(MAX_PROMPT_BODY_BYTES); // each pair is multiple bytes
    expect(validatePromptInput({ title: 'Standup', body })).toBe('Prompt body is too large to save.');
  });

  it('rejects a description longer than the bound', () => {
    const description = 'a'.repeat(MAX_PROMPT_DESCRIPTION_LENGTH + 1);
    expect(validatePromptInput({ title: 'Standup', body: 'x', description })).toBe(
      `Description must be at most ${MAX_PROMPT_DESCRIPTION_LENGTH} characters.`,
    );
  });
});
