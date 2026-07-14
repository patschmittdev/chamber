import type { ConversationSummary } from '@chamber/shared/types';

/** Display buckets for the history rail, derived from pin/archive metadata. */
export interface ConversationPartition {
  pinned: ConversationSummary[];
  regular: ConversationSummary[];
  archived: ConversationSummary[];
}

export interface ConversationSectionSummary {
  key: 'pinned' | 'recent' | 'archived';
  label: 'Pinned' | 'Recent' | 'Archived';
  count: number;
}

export interface ConversationDateGroup {
  id: 'today' | 'yesterday' | 'this-week' | 'this-month' | 'older' | 'unknown';
  label: string;
  conversations: ConversationSummary[];
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

/** Canonical section labels and counts for the history rail. */
export function summarizeConversationSections(partition: ConversationPartition): ConversationSectionSummary[] {
  return [
    { key: 'pinned', label: 'Pinned', count: partition.pinned.length },
    { key: 'recent', label: 'Recent', count: partition.regular.length },
    { key: 'archived', label: 'Archived', count: partition.archived.length },
  ];
}

/** Stable date-bucket id for a conversation's updatedAt value. */
export function resolveConversationDateGroup(updatedAt: string, now: Date = new Date()): ConversationDateGroup['id'] {
  const timestamp = Date.parse(updatedAt);
  if (Number.isNaN(timestamp)) return 'unknown';
  const nowStart = startOfDay(now).getTime();
  const targetStart = startOfDay(new Date(timestamp)).getTime();
  const dayDiff = Math.floor((nowStart - targetStart) / 86_400_000);
  if (dayDiff <= 0) return 'today';
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff < 7) return 'this-week';
  if (dayDiff < 30) return 'this-month';
  return 'older';
}

/** Human label for a date-group bucket id used by the history rail. */
export function conversationDateGroupLabel(id: ConversationDateGroup['id']): string {
  switch (id) {
    case 'today':
      return 'Today';
    case 'yesterday':
      return 'Yesterday';
    case 'this-week':
      return 'Earlier this week';
    case 'this-month':
      return 'Earlier this month';
    case 'older':
      return 'Older';
    case 'unknown':
      return 'Unknown date';
    default:
      return 'Unknown date';
  }
}

/**
 * Groups an already-ordered list into contiguous date buckets so each block can
 * render with a local date heading while preserving incoming order.
 */
export function groupConversationsByDate(
  conversations: readonly ConversationSummary[],
  now: Date = new Date(),
): ConversationDateGroup[] {
  const groups: ConversationDateGroup[] = [];
  for (const conversation of conversations) {
    const id = resolveConversationDateGroup(conversation.updatedAt, now);
    const current = groups[groups.length - 1];
    if (current && current.id === id) {
      current.conversations.push(conversation);
      continue;
    }
    groups.push({
      id,
      label: conversationDateGroupLabel(id),
      conversations: [conversation],
    });
  }
  return groups;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
