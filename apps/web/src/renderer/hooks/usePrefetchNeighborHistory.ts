import { useEffect, useRef } from 'react';
import { useAppState, useAppDispatch } from '../lib/store';
import { Logger } from '../lib/logger';

const log = Logger.create('usePrefetchNeighborHistory');

/**
 * perf-D7: warm the conversation history for the minds immediately before and
 * after the active one, so switching to a neighbor shows its list instantly
 * instead of paying the cold first-load tail (~200ms vs the ~50-67ms median).
 *
 * Best-effort and deduplicated: it never sets a loading state, skips minds
 * whose history is already cached, and silently drops failures (clearing the
 * dedupe entry) so a later switch can retry.
 */
export function usePrefetchNeighborHistory(): void {
  const { minds, activeMindId, conversationHistoryByMind } = useAppState();
  const dispatch = useAppDispatch();
  const prefetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!activeMindId) return;
    const activeIndex = minds.findIndex((mind) => mind.mindId === activeMindId);
    if (activeIndex === -1) return;

    const neighbors = [minds[activeIndex - 1], minds[activeIndex + 1]];
    for (const neighbor of neighbors) {
      if (!neighbor) continue;
      const mindId = neighbor.mindId;
      if (conversationHistoryByMind[mindId] !== undefined) continue;
      if (prefetchedRef.current.has(mindId)) continue;
      prefetchedRef.current.add(mindId);
      window.electronAPI.conversationHistory
        .list(mindId)
        .then((conversations) => {
          dispatch({ type: 'SET_CONVERSATION_HISTORY', payload: { mindId, conversations } });
        })
        .catch((error: unknown) => {
          prefetchedRef.current.delete(mindId);
          log.warn('Failed to prefetch neighbor history:', error);
        });
    }
  }, [activeMindId, minds, conversationHistoryByMind, dispatch]);
}
