import { describe, it, expect } from 'vitest';
import type { ConversationSummary } from '@chamber/shared/types';
import { partitionConversations } from './conversationOrganize';

function makeConversation(overrides: Partial<ConversationSummary>): ConversationSummary {
  return {
    sessionId: 'session',
    title: 'Untitled',
    createdAt: '2026-05-05T22:00:00.000Z',
    updatedAt: '2026-05-05T22:00:00.000Z',
    kind: 'chat',
    active: false,
    hasMessages: true,
    ...overrides,
  };
}

describe('partitionConversations', () => {
  it('splits into pinned, regular, and archived buckets', () => {
    const pinned = makeConversation({ sessionId: 's-pin', isPinned: true });
    const regular = makeConversation({ sessionId: 's-reg' });
    const archived = makeConversation({ sessionId: 's-arch', isArchived: true });

    const result = partitionConversations([pinned, regular, archived]);

    expect(result.pinned).toEqual([pinned]);
    expect(result.regular).toEqual([regular]);
    expect(result.archived).toEqual([archived]);
  });

  it('preserves input order within each bucket', () => {
    const first = makeConversation({ sessionId: 's-1' });
    const second = makeConversation({ sessionId: 's-2' });
    const third = makeConversation({ sessionId: 's-3' });

    const result = partitionConversations([third, first, second]);

    expect(result.regular.map((conversation) => conversation.sessionId)).toEqual(['s-3', 's-1', 's-2']);
  });

  it('routes an archived conversation to archived even when it is also pinned', () => {
    const pinnedAndArchived = makeConversation({ sessionId: 's-both', isPinned: true, isArchived: true });

    const result = partitionConversations([pinnedAndArchived]);

    expect(result.archived).toEqual([pinnedAndArchived]);
    expect(result.pinned).toEqual([]);
  });

  it('keeps input order inside the pinned bucket so pinning never reorders pinned rows', () => {
    const first = makeConversation({ sessionId: 'p-1', isPinned: true });
    const second = makeConversation({ sessionId: 'p-2', isPinned: true });
    const third = makeConversation({ sessionId: 'p-3', isPinned: true });

    const result = partitionConversations([first, second, third]);

    expect(result.pinned.map((conversation) => conversation.sessionId)).toEqual(['p-1', 'p-2', 'p-3']);
  });

  it('returns a still-pinned conversation to the pinned bucket once it is unarchived', () => {
    const pinnedArchived = makeConversation({ sessionId: 's-both', isPinned: true, isArchived: true });
    expect(partitionConversations([pinnedArchived]).archived).toEqual([pinnedArchived]);

    const unarchived = { ...pinnedArchived, isArchived: false };
    const result = partitionConversations([unarchived]);

    expect(result.pinned).toEqual([unarchived]);
    expect(result.archived).toEqual([]);
  });

  it('returns empty buckets for an empty list', () => {
    expect(partitionConversations([])).toEqual({ pinned: [], regular: [], archived: [] });
  });
});
