import { useCallback, useEffect, useRef, useState } from 'react';
import {
  APPEARANCE_STORAGE_KEYS,
  applyResolvedTheme,
  isThemePreference,
  persistThemePreference,
  readStoredThemePreference,
  resolveTheme,
  systemPrefersDark,
  type ResolvedTheme,
  type ThemePreference,
} from '../lib/appearance';

export type { ThemePreference, ResolvedTheme } from '../lib/appearance';

/**
 * @deprecated Use {@link ThemePreference} (the user's choice) or
 * {@link ResolvedTheme} (the value actually painted). Retained so existing
 * imports keep compiling.
 */
export type Theme = ResolvedTheme;

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export interface UseThemeResult {
  /** The user's stored preference, which may be `system`. */
  readonly theme: ThemePreference;
  /** The concrete theme currently painted; never `system`. */
  readonly resolvedTheme: ResolvedTheme;
  readonly setTheme: (preference: ThemePreference) => void;
  readonly toggle: () => void;
}

/**
 * Reads, applies, and persists the theme preference. Supports a `system`
 * preference that follows `prefers-color-scheme` and updates live via
 * `matchMedia`, and mirrors changes made in other windows via the `storage`
 * event.
 */
export function useTheme(): UseThemeResult {
  const [preference, setPreference] = useState<ThemePreference>(readStoredThemePreference);
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark);

  // Follow the OS scheme so a `system` preference reacts live to OS changes.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(DARK_MEDIA_QUERY);
    const handler = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  // Cross-tab sync: another window changed the stored preference.
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEYS.theme && isThemePreference(event.newValue)) {
        setPreference(event.newValue);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const resolvedTheme = resolveTheme(preference, prefersDark);

  // Paint whenever the resolved theme changes. Skip the crossfade on the first
  // application so loading the app does not animate.
  const firstApply = useRef(true);
  useEffect(() => {
    applyResolvedTheme(resolvedTheme, { animate: !firstApply.current });
    firstApply.current = false;
  }, [resolvedTheme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next);
    persistThemePreference(next);
  }, []);

  const toggle = useCallback(() => {
    // Toggling picks an explicit light/dark preference based on what is shown.
    setPreference((current) => {
      const shown = resolveTheme(current, systemPrefersDark());
      const next: ThemePreference = shown === 'dark' ? 'light' : 'dark';
      persistThemePreference(next);
      return next;
    });
  }, []);

  return { theme: preference, resolvedTheme, setTheme, toggle };
}
