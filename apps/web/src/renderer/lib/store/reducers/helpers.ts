import { modelSelectionEqualsModel, modelSelectionKey, modelSelectionKeyFromModel } from '@chamber/shared/model-selection';
import type { ChatEvent, ChatMessage, ContentBlock, ConversationEventRef, ConversationSummary } from '@chamber/shared/types';
import type { AppState, ConversationViewState } from '../state';

export function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export function updateChatMessage<T extends ChatMessage>(
  message: T,
  updates: Partial<Pick<ChatMessage, 'blocks' | 'isStreaming'>>,
): T {
  return { ...message, ...updates };
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

export function handleChatEvent<T extends ChatMessage>(messages: T[], messageId: string, event: ChatEvent): T[] {
  return messages.map((m) => {
    if (m.id !== messageId) return m;

    const blocks = [...m.blocks];

    switch (event.type) {
      case 'chunk': {
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'text') {
          blocks[blocks.length - 1] = { ...last, content: last.content + event.content, sdkMessageId: event.sdkMessageId };
        } else {
          blocks.push({ type: 'text', sdkMessageId: event.sdkMessageId, content: event.content });
        }
        return updateChatMessage(m, { blocks });
      }

      case 'tool_start': {
        blocks.push({
          type: 'tool_call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: 'running',
          arguments: event.args,
          parentToolCallId: event.parentToolCallId,
        });
        return updateChatMessage(m, { blocks });
      }

      case 'tool_progress': {
        const idx = blocks.findIndex(b => b.type === 'tool_call' && b.toolCallId === event.toolCallId);
        if (idx >= 0) {
          const block = blocks[idx] as Extract<ContentBlock, { type: 'tool_call' }>;
          blocks[idx] = { ...block, output: (block.output || '') + event.message + '\n' };
        }
        return updateChatMessage(m, { blocks });
      }

      case 'tool_output': {
        const idx = blocks.findIndex(b => b.type === 'tool_call' && b.toolCallId === event.toolCallId);
        if (idx >= 0) {
          const block = blocks[idx] as Extract<ContentBlock, { type: 'tool_call' }>;
          blocks[idx] = { ...block, output: (block.output || '') + event.output };
        }
        return updateChatMessage(m, { blocks });
      }

      case 'tool_done': {
        const idx = blocks.findIndex(b => b.type === 'tool_call' && b.toolCallId === event.toolCallId);
        if (idx >= 0) {
          const block = blocks[idx] as Extract<ContentBlock, { type: 'tool_call' }>;
          blocks[idx] = {
            ...block,
            status: event.success ? 'done' : 'error',
            ...(event.result && { output: (block.output || '') + event.result }),
            ...(event.error && { error: event.error }),
          };
        }
        return updateChatMessage(m, { blocks });
      }

      case 'permission_request': {
        if (blocks.some(b => b.type === 'permission' && b.requestId === event.requestId)) {
          return m;
        }
        blocks.push({
          type: 'permission',
          requestId: event.requestId,
          kind: event.kind,
          summary: event.summary,
          outcome: 'pending',
          ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
        });
        return updateChatMessage(m, { blocks });
      }

      case 'permission_outcome': {
        const idx = blocks.findIndex(b => b.type === 'permission' && b.requestId === event.requestId);
        if (idx >= 0) {
          const block = blocks[idx] as Extract<ContentBlock, { type: 'permission' }>;
          blocks[idx] = { ...block, outcome: event.outcome };
        }
        return updateChatMessage(m, { blocks });
      }

      case 'reasoning': {
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'reasoning' && last.reasoningId === event.reasoningId) {
          blocks[blocks.length - 1] = { ...last, content: last.content + event.content };
        } else {
          blocks.push({ type: 'reasoning', reasoningId: event.reasoningId, content: event.content });
        }
        return updateChatMessage(m, { blocks });
      }

      case 'message_final': {
        // Reconciliation: add text only if this sdkMessageId was never streamed via chunks.
        const hasThisMessage = blocks.some(b => b.type === 'text' && b.sdkMessageId === event.sdkMessageId);
        if (!hasThisMessage && event.content) {
          blocks.push({ type: 'text', sdkMessageId: event.sdkMessageId, content: event.content });
          return updateChatMessage(m, { blocks });
        }
        return m;
      }

      case 'reconnecting':
        return m;

      case 'done':
        return updateChatMessage(m, { isStreaming: false });

      case 'error':
        return updateChatMessage(m, {
          isStreaming: false,
          blocks: [...blocks, { type: 'text' as const, content: `Error: ${event.message}` }],
        });

      case 'timeout':
        return updateChatMessage(m, {
          isStreaming: false,
          blocks: [...blocks, { type: 'text' as const, content: `Agent timed out after ${Math.round(event.timeoutMs / 1000)}s` }],
        });

      default:
        return m;
    }
  });
}
