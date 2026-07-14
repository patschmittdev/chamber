import type { ChatMessage, ConversationSummary } from '@chamber/shared/types';

export type ConversationContentIndex = ReadonlyMap<string, string>;

export interface ConversationSearchFeedback {
  resultCount: number;
  titleMatchCount: number;
  contentMatchCount: number;
  contentOnlyMatchCount: number;
  indexableConversationCount: number;
  indexedConversationCount: number;
  isIndexing: boolean;
}

/** Trim and lowercase a raw search box value for case-insensitive matching. */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Filter a mind's conversations by a search query. A conversation matches when
 * its title contains the query, or when the optional content index holds a
 * cached transcript for that conversation that contains the query. An empty
 * query returns the list unchanged; per-mind scoping is the caller's concern.
 */
export function filterConversations(
  conversations: readonly ConversationSummary[],
  query: string,
  contentIndex?: ConversationContentIndex,
): ConversationSummary[] {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return [...conversations];

  return conversations.filter((conversation) => classifyConversationMatch(conversation, normalized, contentIndex) !== 'none');
}

/** Flatten a conversation's text-bearing blocks into a lowercase search string. */
export function conversationSearchText(messages: readonly ChatMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === 'text' || block.type === 'reasoning') {
        parts.push(block.content);
      }
    }
  }
  return parts.join('\n').toLowerCase();
}

export function getConversationSearchFeedback(
  conversations: readonly ConversationSummary[],
  query: string,
  contentIndex?: ConversationContentIndex,
): ConversationSearchFeedback {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return {
      resultCount: 0,
      titleMatchCount: 0,
      contentMatchCount: 0,
      contentOnlyMatchCount: 0,
      indexableConversationCount: 0,
      indexedConversationCount: 0,
      isIndexing: false,
    };
  }

  let resultCount = 0;
  let titleMatchCount = 0;
  let contentMatchCount = 0;
  let contentOnlyMatchCount = 0;
  let indexableConversationCount = 0;
  let indexedConversationCount = 0;

  for (const conversation of conversations) {
    if (conversation.hasMessages !== false) {
      indexableConversationCount += 1;
      if (contentIndex?.has(conversation.sessionId)) {
        indexedConversationCount += 1;
      }
    }
    const match = classifyConversationMatch(conversation, normalized, contentIndex);
    if (match === 'none') continue;
    resultCount += 1;
    if (match === 'title' || match === 'both') {
      titleMatchCount += 1;
    }
    if (match === 'content' || match === 'both') {
      contentMatchCount += 1;
    }
    if (match === 'content') {
      contentOnlyMatchCount += 1;
    }
  }

  return {
    resultCount,
    titleMatchCount,
    contentMatchCount,
    contentOnlyMatchCount,
    indexableConversationCount,
    indexedConversationCount,
    isIndexing: indexableConversationCount > indexedConversationCount,
  };
}

function classifyConversationMatch(
  conversation: ConversationSummary,
  normalizedQuery: string,
  contentIndex?: ConversationContentIndex,
): 'none' | 'title' | 'content' | 'both' {
  const titleMatch = conversation.title.toLowerCase().includes(normalizedQuery);
  const content = contentIndex?.get(conversation.sessionId);
  const contentMatch = Boolean(content && content.includes(normalizedQuery));
  if (titleMatch && contentMatch) return 'both';
  if (titleMatch) return 'title';
  if (contentMatch) return 'content';
  return 'none';
}
