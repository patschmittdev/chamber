import { describe, it, expect, beforeEach } from 'vitest';
import type { Prompt } from '@chamber/shared/types';
import { MAX_PROMPTS } from '@chamber/shared/prompt-authoring';
import { PromptLibraryService, type PromptLibraryStorePort } from './PromptLibraryService';

class FakeStore implements PromptLibraryStorePort {
  prompts: Prompt[] = [];
  writes = 0;
  writeError: Error | null = null;

  read(): Prompt[] {
    return this.prompts;
  }

  write(prompts: Prompt[]): void {
    if (this.writeError) throw this.writeError;
    this.writes += 1;
    this.prompts = prompts;
  }
}

const FIXED_NOW = new Date('2024-06-01T12:00:00.000Z');

function makeService(store: FakeStore, ids: string[] = ['id-1', 'id-2', 'id-3']): PromptLibraryService {
  let cursor = 0;
  return new PromptLibraryService(
    store,
    () => ids[cursor++] ?? `id-${cursor}`,
    () => FIXED_NOW,
  );
}

describe('PromptLibraryService', () => {
  let store: FakeStore;
  let service: PromptLibraryService;

  beforeEach(() => {
    store = new FakeStore();
    service = makeService(store);
  });

  it('lists the prompts held by the store', () => {
    store.prompts = [{ id: 'a', title: 'A', body: 'x', createdAt: 't', updatedAt: 't' }];
    expect(service.list()).toEqual(store.prompts);
  });

  it('creates a prompt with a minted id and timestamps and returns the refreshed list', () => {
    const result = service.save({ id: null, title: 'Standup', body: 'Summarize my day.', description: 'Daily' });
    expect(result).toEqual({
      success: true,
      prompts: [
        {
          id: 'id-1',
          title: 'Standup',
          body: 'Summarize my day.',
          description: 'Daily',
          createdAt: FIXED_NOW.toISOString(),
          updatedAt: FIXED_NOW.toISOString(),
        },
      ],
    });
    expect(store.prompts).toEqual(result.prompts);
  });

  it('trims fields and omits a blank description on create', () => {
    const result = service.save({ id: null, title: '  Standup  ', body: '  Summarize.  ', description: '   ' });
    expect(result.prompts?.[0]).toMatchObject({ title: 'Standup', body: 'Summarize.' });
    expect(result.prompts?.[0].description).toBeUndefined();
  });

  it('rejects invalid input without writing', () => {
    const result = service.save({ id: null, title: '   ', body: 'x' });
    expect(result).toEqual({ success: false, error: 'Title is required.' });
    expect(store.writes).toBe(0);
  });

  it('enforces the maximum prompt count on create', () => {
    store.prompts = Array.from({ length: MAX_PROMPTS }, (_unused, i) => ({
      id: `p-${i}`,
      title: 'T',
      body: 'b',
      createdAt: 't',
      updatedAt: 't',
    }));
    const result = service.save({ id: null, title: 'One more', body: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain(String(MAX_PROMPTS));
    expect(store.writes).toBe(0);
  });

  it('updates an existing prompt, preserving createdAt and refreshing updatedAt', () => {
    store.prompts = [
      { id: 'keep', title: 'Old', body: 'old body', description: 'old', createdAt: 'created', updatedAt: 'created' },
    ];
    const result = service.save({ id: 'keep', title: 'New', body: 'new body' });
    expect(result.prompts).toEqual([
      { id: 'keep', title: 'New', body: 'new body', createdAt: 'created', updatedAt: FIXED_NOW.toISOString() },
    ]);
  });

  it('reports a missing prompt on update without writing', () => {
    const result = service.save({ id: 'ghost', title: 'New', body: 'body' });
    expect(result).toEqual({ success: false, error: 'Prompt not found.' });
    expect(store.writes).toBe(0);
  });

  it('deletes a prompt by id and returns the remaining list', () => {
    store.prompts = [
      { id: 'a', title: 'A', body: 'x', createdAt: 't', updatedAt: 't' },
      { id: 'b', title: 'B', body: 'y', createdAt: 't', updatedAt: 't' },
    ];
    const result = service.delete('a');
    expect(result).toEqual({
      success: true,
      prompts: [{ id: 'b', title: 'B', body: 'y', createdAt: 't', updatedAt: 't' }],
    });
  });

  it('reports a missing prompt on delete without writing', () => {
    store.prompts = [{ id: 'a', title: 'A', body: 'x', createdAt: 't', updatedAt: 't' }];
    const result = service.delete('ghost');
    expect(result).toEqual({ success: false, error: 'Prompt not found.' });
    expect(store.writes).toBe(0);
  });

  it('surfaces a store write failure as a failure result instead of throwing', () => {
    store.prompts = [{ id: 'a', title: 'A', body: 'x', createdAt: 't', updatedAt: 't' }];
    store.writeError = new Error('EACCES: permission denied, rename');
    expect(service.save({ id: null, title: 'Standup', body: 'x' })).toEqual({
      success: false,
      error: 'EACCES: permission denied, rename',
    });
    expect(service.delete('a')).toEqual({
      success: false,
      error: 'EACCES: permission denied, rename',
    });
  });
});
