import { useCallback, useEffect, useState } from 'react';
import type { MindContext, MindInstructionPrecedence } from '@chamber/shared/types';

export interface InstructionPrecedenceController {
  /** Latest precedence snapshot per mind, keyed by mindId. */
  precedenceByMindId: Record<string, MindInstructionPrecedence>;
  /** The mind currently persisting an inheritance change, or null when idle. */
  savingMindId: string | null;
  /** Re-fetch precedence for every tracked mind. */
  refresh: () => Promise<void>;
  /** Toggle a mind's global-custom-instruction inheritance and return the resolved precedence. */
  setInheritance: (mindId: string, enabled: boolean) => Promise<MindInstructionPrecedence>;
}

/**
 * Owns per-mind custom-instruction precedence so every settings surface (the
 * Custom instructions section and the Agents detail pane) reads and mutates a
 * single source of truth instead of duplicating the fetch/toggle plumbing.
 */
export function useInstructionPrecedence(minds: MindContext[]): InstructionPrecedenceController {
  const [precedenceByMindId, setPrecedenceByMindId] = useState<Record<string, MindInstructionPrecedence>>({});
  const [savingMindId, setSavingMindId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (minds.length === 0) {
      setPrecedenceByMindId({});
      return;
    }
    const entries = await Promise.all(minds.map(async (mind) => [
      mind.mindId,
      await window.electronAPI.mind.getInstructionPrecedence(mind.mindId),
    ] as const));
    setPrecedenceByMindId(Object.fromEntries(entries));
  }, [minds]);

  useEffect(() => {
    let cancelled = false;
    refresh().catch((error: unknown) => {
      if (!cancelled) console.warn('Failed to load instruction precedence', error);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const setInheritance = useCallback(async (mindId: string, enabled: boolean): Promise<MindInstructionPrecedence> => {
    setSavingMindId(mindId);
    try {
      const precedence = await window.electronAPI.mind.setGlobalCustomInstructionsEnabled(mindId, enabled);
      setPrecedenceByMindId((previous) => ({ ...previous, [mindId]: precedence }));
      return precedence;
    } finally {
      setSavingMindId(null);
    }
  }, []);

  return { precedenceByMindId, savingMindId, refresh, setInheritance };
}
