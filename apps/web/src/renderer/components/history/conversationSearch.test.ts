import { describe, it, expect } from 'vitest';
import type { ChatMessage, ConversationSummary } from '@chamber/shared/types';
import {
  conversationSearchText,
  filterConversations,
  getConversationSearchFeedback,
  normalizeSearchQuery,
} from './conversationSearch';

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

const roadmap = makeConversation({ sessionId: 's-roadmap', title: 'Q3 Roadmap planning' });
const standup = makeConversation({ sessionId: 's-standup', title: 'Daily standup notes' });
const bugfix = makeConversation({ sessionId: 's-bugfix', title: 'Login bug triage' });
const conversations = [roadmap, standup, bugfix];

describe('normalizeSearchQuery', () => {
  it('trims and lowercases the query', () => {
    expect(normalizeSearchQuery('  RoadMap  ')).toBe('roadmap');
  });
});

describe('filterConversations', () => {
  it('returns a copy of the full list for an empty or whitespace query', () => {
    expect(filterConversations(conversations, '')).toEqual(conversations);
    expect(filterConversations(conversations, '   ')).toEqual(conversations);
    expect(filterConversations(conversations, '')).not.toBe(conversations);
  });

  it('matches by title case-insensitively', () => {
    expect(filterConversations(conversations, 'roadmap')).toEqual([roadmap]);
    expect(filterConversations(conversations, 'STANDUP')).toEqual([standup]);
  });

  it('returns an empty list when nothing matches and no content is indexed', () => {
    expect(filterConversations(conversations, 'nonexistent')).toEqual([]);
  });

  it('matches by indexed message content when the title does not match', () => {
    const contentIndex = new Map<string, string>([
      ['s-bugfix', 'the user cannot authenticate with saml sso'],
    ]);

    expect(filterConversations(conversations, 'saml', contentIndex)).toEqual([bugfix]);
  });

  it('prefers a title match even when content is not indexed', () => {
    const contentIndex = new Map<string, string>();
    expect(filterConversations(conversations, 'triage', contentIndex)).toEqual([bugfix]);
  });
});

describe('conversationSearchText', () => {
  it('flattens text and reasoning blocks into a lowercase string and ignores non-text blocks', () => {
    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', timestamp: 1, blocks: [{ type: 'text', content: 'Deploy the API' }] },
      {
        id: 'a1',
        role: 'assistant',
        timestamp: 2,
        blocks: [
          { type: 'reasoning', reasoningId: 'r1', content: 'Check CANARY first' },
          { type: 'text', content: 'Rolling out now' },
          { type: 'image', name: 'chart.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
        ],
      },
    ];

    const text = conversationSearchText(messages);

    expect(text).toContain('deploy the api');
    expect(text).toContain('check canary first');
    expect(text).toContain('rolling out now');
    expect(text).not.toContain('chart.png');
  });

  it('returns an empty string for a conversation with no text blocks', () => {
    expect(conversationSearchText([])).toBe('');
  });
});

describe('getConversationSearchFeedback', () => {
  it('returns title and content match counts with total results', () => {
    const contentIndex = new Map<string, string>([
      ['s-roadmap', 'roadmap details and risks'],
      ['s-bugfix', 'saml login fail details'],
    ]);

    const feedback = getConversationSearchFeedback(conversations, 'roadmap', contentIndex);
    expect(feedback).toEqual({
      resultCount: 1,
      titleMatchCount: 1,
      contentMatchCount: 1,
      contentOnlyMatchCount: 0,
      indexableConversationCount: 3,
      indexedConversationCount: 2,
      isIndexing: true,
    });
  });

  it('counts content-only matches and reports indexing completion', () => {
    const contentIndex = new Map<string, string>([
      ['s-roadmap', 'roadmap details and risks'],
      ['s-standup', 'daily sync notes'],
      ['s-bugfix', 'saml login fail details'],
    ]);

    const feedback = getConversationSearchFeedback(conversations, 'saml', contentIndex);
    expect(feedback).toEqual({
      resultCount: 1,
      titleMatchCount: 0,
      contentMatchCount: 1,
      contentOnlyMatchCount: 1,
      indexableConversationCount: 3,
      indexedConversationCount: 3,
      isIndexing: false,
    });
  });
});
