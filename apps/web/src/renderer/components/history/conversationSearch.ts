import type { ChatMessage, ConversationSummary } from '@chamber/shared/types';

export type ConversationContentIndex = ReadonlyMap<string, string>;

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

  return conversations.filter((conversation) => {
    if (conversation.title.toLowerCase().includes(normalized)) return true;
    const content = contentIndex?.get(conversation.sessionId);
    return content ? content.includes(normalized) : false;
  });
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
