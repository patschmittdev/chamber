import { useCallback, useEffect } from 'react';
import { useAppState, useAppDispatch, getPlainContent } from '../lib/store';
import { generateId } from '../lib/utils';
import type { AttachmentBlock, ChatAttachment, ChatMessage, ImageBlock } from '@chamber/shared/types';
import { hasAttachmentBlocks } from '../components/chat/messageContent';
import { Logger } from '../lib/logger';

const log = Logger.create('useChatStreaming');

// Tracks the in-flight assistant messageId per mind so Stop can target the
// active turn. Module-scoped (not a per-hook ref) so a turn started from one
// consumer (e.g. a message-row Regenerate) can still be stopped from another
// (e.g. the composer's Stop button).
const currentMessageIdByMind: Record<string, string> = {};

export function useChatStreaming() {
  const { activeMindId, isStreaming, selectedModel, streamingByMind, messagesByMind } = useAppState();
  const dispatch = useAppDispatch();

  const refreshConversationHistory = useCallback(async (mindId: string) => {
    try {
      const conversations = await window.electronAPI.conversationHistory.list(mindId);
      dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId, conversations } });
    } catch (error) {
      log.warn('Failed to refresh conversation history:', error);
    }
  }, [dispatch]);

  const beginAssistantTurn = useCallback((mindId: string): string => {
    const assistantId = generateId();
    currentMessageIdByMind[mindId] = assistantId;
    dispatch({
      type: 'ADD_ASSISTANT_MESSAGE',
      payload: { id: assistantId, timestamp: Date.now() },
    });
    return assistantId;
  }, [dispatch]);

  const sendMessage = useCallback(async (content: string, attachments?: ChatAttachment[]) => {
    const hasText = content.trim().length > 0;
    const hasAttachments = !!attachments && attachments.length > 0;
    if (isStreaming || (!hasText && !hasAttachments) || !activeMindId) return;

    const images: ImageBlock[] | undefined = attachments
      ?.filter((attachment) => attachment.kind === 'image')
      .map((attachment) => ({
        type: 'image',
        name: attachment.displayName,
        mimeType: attachment.mimeType,
        dataUrl: `data:${attachment.mimeType};base64,${attachment.data}`,
      }));
    const documents: AttachmentBlock[] | undefined = attachments
      ?.filter((attachment) => attachment.kind === 'document')
      .map((attachment) => ({
        type: 'attachment',
        id: attachment.clientId,
        kind: 'document',
        displayName: attachment.displayName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        ...(attachment.metadata ? { metadata: attachment.metadata } : {}),
      }));

    dispatch({
      type: 'ADD_USER_MESSAGE',
      payload: { id: generateId(), content: content.trim(), timestamp: Date.now(), images, documents },
    });

    const mindId = activeMindId;
    const assistantId = beginAssistantTurn(mindId);
    await window.electronAPI.chat.send(mindId, content.trim(), assistantId, selectedModel ?? undefined, attachments);
    await refreshConversationHistory(mindId);
  }, [activeMindId, isStreaming, selectedModel, dispatch, beginAssistantTurn, refreshConversationHistory]);

  // Re-run the most recent user turn. The main process resolves and truncates
  // the last user turn from persisted history, so the renderer only replaces
  // the last exchange optimistically and streams a fresh response.
  const regenerate = useCallback(async () => {
    if (isStreaming || !activeMindId) return;
    const messages = messagesByMind[activeMindId] ?? [];
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUser) return;
    // Attachments cannot be replayed yet (only the text prompt is resent), and an
    // unsaved turn has no backing event id for the main process to truncate.
    // The UI already hides Regenerate in these cases; guard here too.
    if (!lastUser.eventId || hasAttachmentBlocks(lastUser)) return;

    const mindId = activeMindId;
    const prompt = getPlainContent(lastUser);
    dispatch({ type: 'TRUNCATE_AFTER', payload: { mindId, messageId: lastUser.id } });
    dispatch({ type: 'ADD_USER_MESSAGE', payload: { id: generateId(), content: prompt, timestamp: Date.now() } });
    const assistantId = beginAssistantTurn(mindId);
    await window.electronAPI.chat.regenerate(mindId, assistantId, selectedModel ?? undefined);
    await refreshConversationHistory(mindId);
  }, [activeMindId, isStreaming, selectedModel, messagesByMind, dispatch, beginAssistantTurn, refreshConversationHistory]);

  // Replace a user turn with edited text. Requires the turn's backing event id
  // so the main process can truncate history back to it (dropping the old
  // exchange) before streaming the new response.
  const editAndResubmit = useCallback(async (message: ChatMessage, newText: string) => {
    if (isStreaming || !activeMindId || message.role !== 'user' || !message.eventId) return;
    // Attachments cannot be reconstructed and resent yet; refuse rather than silently
    // dropping them (the UI disables Edit for these turns as well).
    if (hasAttachmentBlocks(message)) return;
    const text = newText.trim();
    if (!text) return;

    const mindId = activeMindId;
    const eventId = message.eventId;
    dispatch({ type: 'TRUNCATE_AFTER', payload: { mindId, messageId: message.id } });
    dispatch({ type: 'ADD_USER_MESSAGE', payload: { id: generateId(), content: text, timestamp: Date.now() } });
    const assistantId = beginAssistantTurn(mindId);
    await window.electronAPI.chat.editMessage(mindId, eventId, text, assistantId, selectedModel ?? undefined);
    await refreshConversationHistory(mindId);
  }, [activeMindId, isStreaming, selectedModel, dispatch, beginAssistantTurn, refreshConversationHistory]);

  const stopStreaming = useCallback(async () => {
    if (activeMindId && currentMessageIdByMind[activeMindId]) {
      await window.electronAPI.chat.stop(activeMindId, currentMessageIdByMind[activeMindId]);
    }
  }, [activeMindId]);

  useEffect(() => {
    if (activeMindId && !streamingByMind[activeMindId]) {
      delete currentMessageIdByMind[activeMindId];
    }
  }, [activeMindId, streamingByMind]);

  return { sendMessage, stopStreaming, regenerate, editAndResubmit, isStreaming };
}
