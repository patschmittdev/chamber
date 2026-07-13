import { useCallback, useState } from 'react';

/**
 * Boolean collapse flag persisted to localStorage under a `chamber:*` key so a
 * side rail's collapse preference survives reloads. Extracted from the
 * conversation history panel's inline idiom so both shell side rails share one
 * implementation. Returns the current value and a setter that also writes
 * through to storage.
 */
export function usePersistedCollapse(storageKey: string): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(storageKey) === 'true';
    } catch {
      return false;
    }
  });

  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState(next);
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        /* storage unavailable */
      }
    },
    [storageKey],
  );

  return [collapsed, setCollapsed];
}
