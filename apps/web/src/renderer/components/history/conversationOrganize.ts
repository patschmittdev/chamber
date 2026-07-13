import type { ConversationSummary } from '@chamber/shared/types';

/** Display buckets for the history rail, derived from pin/archive metadata. */
export interface ConversationPartition {
  pinned: ConversationSummary[];
  regular: ConversationSummary[];
  archived: ConversationSummary[];
}

/**
 * Splits an already-ordered conversation list into display buckets, preserving
 * the input order within each bucket. The service already sorts by recency, so
 * this only partitions and never re-sorts. Archive wins over pin: an archived
 * conversation always lands in `archived`, even when it is also pinned, so it
 * cannot appear in two sections at once.
 */
export function partitionConversations(conversations: ConversationSummary[]): ConversationPartition {
  const pinned: ConversationSummary[] = [];
  const regular: ConversationSummary[] = [];
  const archived: ConversationSummary[] = [];

  for (const conversation of conversations) {
    if (conversation.isArchived) {
      archived.push(conversation);
    } else if (conversation.isPinned) {
      pinned.push(conversation);
    } else {
      regular.push(conversation);
    }
  }

  return { pinned, regular, archived };
}
