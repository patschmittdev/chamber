import { useCallback } from 'react';
import { useAppState, useAppDispatch } from '../lib/store';
import type { ChatMessage } from '@chamber/shared/types';
import { Logger } from '../lib/logger';

const log = Logger.create('useConversationActions');

/**
 * Non-streaming conversation mutations invoked from message rows. Delete
 * truncates persisted history back to the target turn (removing it and any
 * later turns). It is backend-first: the main process performs (and persists)
 * the truncation before the transcript is trimmed, so a failed delete leaves
 * the visible conversation untouched instead of dropping turns the backend
 * still holds.
 */
export function useConversationActions() {
  const { activeMindId } = useAppState();
  const dispatch = useAppDispatch();

  const deleteMessage = useCallback(async (message: ChatMessage) => {
    if (!activeMindId || !message.eventId) return;
    const mindId = activeMindId;
    try {
      const conversations = await window.electronAPI.chat.deleteMessage(mindId, message.eventId);
      dispatch({ type: 'TRUNCATE_AFTER', payload: { mindId, messageId: message.id } });
      dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId, conversations } });
    } catch (error) {
      log.error('Failed to delete message:', error);
    }
  }, [activeMindId, dispatch]);

  return { deleteMessage };
}
