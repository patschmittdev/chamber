import { modelSelectionEqualsModel, modelSelectionKey, modelSelectionKeyFromModel } from '@chamber/shared/model-selection';
import type { ChatEvent, ChatMessage, ContentBlock, ConversationEventRef, ConversationSummary } from '@chamber/shared/types';
import { applyChatEventToMessage } from '@chamber/shared';
import type { AppState, ConversationViewState } from '../state';

export function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/** Returns a shallow copy of `record` without `key`, or the same reference when the key is absent. */
export function withoutKey<T>(record: Record<string, T>, key: string | null | undefined): Record<string, T> {
  if (!key || !(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export function selectedModelForActiveMind(
  state: AppState,
  activeMindId: string | null,
  minds = state.minds,
): string | null {
  if (!activeMindId) return null;
  const mind = minds.find((candidate) => candidate.mindId === activeMindId);
  const selection = mind?.selectedModel
    ? { id: mind.selectedModel, provider: mind.selectedModelProvider }
    : null;
  if (
    selection
    && (state.availableModels.length === 0 || state.availableModels.some((model) => modelSelectionEqualsModel(selection, model)))
  ) {
    return modelSelectionKey(selection);
  }

  return state.availableModels[0] ? modelSelectionKeyFromModel(state.availableModels[0]) : null;
}

export function defaultConversationView(): ConversationViewState {
  return { status: 'idle', streaming: false, modelSwitching: false };
}

export function conversationViewFor(state: AppState, mindId: string): ConversationViewState {
  return state.conversationViewByMind[mindId] ?? defaultConversationView();
}

export function isMindChatStreaming(
  state: AppState,
  mindId: string,
  streamingByMind = state.streamingByMind,
  conversationViewByMind = state.conversationViewByMind,
): boolean {
  return Boolean(streamingByMind[mindId] || conversationViewByMind[mindId]?.streaming);
}

export function setConversationView(
  state: AppState,
  mindId: string,
  patch: Partial<ConversationViewState>,
): Record<string, ConversationViewState> {
  return {
    ...state.conversationViewByMind,
    [mindId]: {
      ...conversationViewFor(state, mindId),
      ...patch,
    },
  };
}

export function mergeConversationSummaries(
  existing: ConversationSummary[] | undefined,
  incoming: ConversationSummary[],
): ConversationSummary[] {
  if (!existing?.length) return incoming;
  const existingById = new Map(existing.map((conversation) => [conversation.sessionId, conversation]));
  return incoming.map((conversation) => {
    const current = existingById.get(conversation.sessionId);
    if (!current) return conversation;
    if (isPlaceholderConversationTitle(current.title) && !isPlaceholderConversationTitle(conversation.title)) {
      return conversation;
    }
    const currentUpdatedAt = Date.parse(current.updatedAt);
    const incomingUpdatedAt = Date.parse(conversation.updatedAt);
    if (Number.isNaN(currentUpdatedAt) || Number.isNaN(incomingUpdatedAt)) return conversation;
    return currentUpdatedAt > incomingUpdatedAt ? current : conversation;
  });
}

function isPlaceholderConversationTitle(title: string): boolean {
  return title === 'New chat' || title.startsWith('New chat · ');
}

export function getPlainContent(message: ChatMessage): string {
  return message.blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.content)
    .join('');
}

/**
 * Annotates live messages with the backing SDK event ids they lack, using the
 * persisted turn references returned after a turn completes. Assistant turns
 * match by their streamed `sdkMessageId`; user turns (which carry no SDK id in
 * the renderer) match positionally against the persisted user turns in order.
 * Messages that already have an `eventId` are left untouched. Returns the same
 * array reference when nothing changed so the reducer can no-op.
 */
export function reconcileMessageEventIds(
  messages: ChatMessage[],
  events: ConversationEventRef[],
): ChatMessage[] {
  const assistantEventByMessageId = new Map<string, string>();
  const userEventIds: string[] = [];
  for (const ref of events) {
    if (ref.role === 'assistant') {
      assistantEventByMessageId.set(ref.messageId, ref.eventId);
    } else {
      userEventIds.push(ref.eventId);
    }
  }

  // User turns carry no SDK id in the renderer, so they can only be matched
  // positionally. Only trust that when the displayed and persisted user turns
  // line up 1:1 — otherwise a turn that failed to persist could shift every id
  // and mistarget a later edit/delete. Assistant turns always match by their
  // streamed sdkMessageId, which is unaffected.
  //
  // KNOWN LIMITATION: SDK skill-context injections are persisted as synthetic
  // `user.message` events but are never streamed as user rows, so mid-session
  // their presence trips this guard (counts disagree) and user-turn actions
  // simply do not appear until a resume re-hydrates the injections and the
  // counts line up again. That is graceful (no mistargeting), just surprising
  // for lens/cron workflows.
  const displayedUserCount = messages.reduce((count, message) => message.role === 'user' ? count + 1 : count, 0);
  const canPositionUsers = displayedUserCount === userEventIds.length;

  let userIndex = 0;
  let changed = false;
  const next = messages.map((message) => {
    if (message.role === 'user') {
      const eventId = userEventIds[userIndex];
      userIndex += 1;
      if (canPositionUsers && !message.eventId && eventId) {
        changed = true;
        return { ...message, eventId };
      }
      return message;
    }

    // Assistant rows match by their streamed sdkMessageId. KNOWN LIMITATION: a
    // tool-first assistant turn (whose eliciting `assistant.message` carries no
    // text and is dropped by the main-process mapper) reconciles to its FINAL
    // message event. Deleting such a row truncates at that final event, so the
    // turn's earlier tool events remain in SDK history (they are invisible after
    // reload, since the mapper only surfaces user/assistant messages). Follow-up
    // would surface a turn-boundary event id for turn-atomic truncation.
    if (message.eventId) return message;
    const sdkMessageId = message.blocks.find(
      (block): block is Extract<ContentBlock, { type: 'text' }> =>
        block.type === 'text' && typeof block.sdkMessageId === 'string',
    )?.sdkMessageId;
    const eventId = sdkMessageId ? assistantEventByMessageId.get(sdkMessageId) : undefined;
    if (eventId) {
      changed = true;
      return { ...message, eventId };
    }
    return message;
  });

  return changed ? next : messages;
}

// perf-D4: streaming produces a new messages array on every delta, but ids and
// positions are stable within a mind's transcript (React already relies on id
// uniqueness for row keys). Caching an id -> index map per array, keyed weakly
// by array identity, turns the per-delta "find the one message to update" from
// an O(N) map/allocation into an amortized O(1) lookup: the map is built once
// for a fresh array and then carried onto each sliced copy the stream creates.
const messageIndexCache = new WeakMap<readonly ChatMessage[], Map<string, number>>();

function messageIndexFor(messages: readonly ChatMessage[]): Map<string, number> {
  const cached = messageIndexCache.get(messages);
  if (cached) return cached;
  const index = new Map<string, number>();
  for (let position = 0; position < messages.length; position += 1) {
    index.set(messages[position].id, position);
  }
  messageIndexCache.set(messages, index);
  return index;
}

export function handleChatEvent<T extends ChatMessage>(messages: T[], messageId: string, event: ChatEvent): T[] {
  const index = messageIndexFor(messages);
  const at = index.get(messageId);
  if (at === undefined) return messages;

  const updated = applyChatEventToMessage(messages[at], event) as T;
  if (updated === messages[at]) return messages;

  const next = messages.slice();
  next[at] = updated;
  // The copy shares ids and positions with `messages`, so the same index map is
  // still valid; carry it over so the next delta in the stream reuses it.
  messageIndexCache.set(next, index);
  return next;
}
