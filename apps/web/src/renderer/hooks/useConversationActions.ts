import { useCallback } from 'react';
import { useAppState, useAppDispatch } from '../lib/store';
import type { ChatMessage } from '@chamber/shared/types';
import { Logger } from '../lib/logger';
import { useActiveMindBusy } from './useActiveMindBusy';

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
  const { activeMindId, activeConversationByMind } = useAppState();
  const { isBusy } = useActiveMindBusy();
  const dispatch = useAppDispatch();

  const deleteMessage = useCallback(async (message: ChatMessage) => {
    if (isBusy || !activeMindId || !message.eventId) return;
    const mindId = activeMindId;
    try {
      const conversations = await window.electronAPI.chat.deleteMessage(mindId, message.eventId);
      dispatch({ type: 'TRUNCATE_AFTER', payload: { mindId, messageId: message.id } });
      dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId, conversations } });
    } catch (error) {
      log.error('Failed to delete message:', error);
    }
  }, [activeMindId, isBusy, dispatch]);

  const forkMessage = useCallback(async (message: ChatMessage) => {
    if (isBusy || !activeMindId || !message.eventId) return;
    const mindId = activeMindId;
    const sourceSessionId = activeConversationByMind[mindId];
    if (!sourceSessionId) return;
    try {
      const result = await window.electronAPI.chat.forkConversation(mindId, sourceSessionId, message.eventId);
      dispatch({
        type: 'RESUME_CONVERSATION',
        payload: {
          mindId,
          sessionId: result.sessionId,
          messages: result.messages,
          conversations: result.conversations,
        },
      });
    } catch (error) {
      log.error('Failed to fork conversation:', error);
    }
  }, [activeMindId, activeConversationByMind, isBusy, dispatch]);

  return { deleteMessage, forkMessage, isBusy };
}
