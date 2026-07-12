/**
 * Appearance preferences: the single source of truth for how Chamber's theme,
 * font scale, and density are read, persisted, and applied.
 *
 * Kept framework-agnostic (no React) so the renderer entry can apply stored
 * preferences at startup and the appearance hooks/store can share the exact same
 * read/apply logic instead of duplicating it. "Apply" means reflecting a
 * preference everywhere it shows: DOM classes for all three, plus the native
 * Windows title-bar overlay for the theme (see `applyResolvedTheme`).
 */

import {
  DEFAULT_DENSITY,
  DEFAULT_FONT_SCALE,
  DEFAULT_THEME_PREFERENCE,
  DENSITIES,
  FONT_SCALES,
  THEME_PREFERENCES,
  isAppearanceSnapshot,
  isDensity,
  isFontScale,
  isThemePreference,
  resolveThemePreference,
} from '@chamber/shared/appearance-types';
import type {
  AppearancePreferences,
  AppearanceSnapshot,
  Density,
  FontScale,
  ResolvedTheme,
  ThemePreference,
} from '@chamber/shared/appearance-types';

export {
  DEFAULT_DENSITY,
  DEFAULT_FONT_SCALE,
  DEFAULT_THEME_PREFERENCE,
  DENSITIES,
  FONT_SCALES,
  THEME_PREFERENCES,
  isDensity,
  isFontScale,
  isThemePreference,
};
export type {
  AppearancePreferences,
  AppearanceSnapshot,
  Density,
  FontScale,
  ResolvedTheme,
  ThemePreference,
};

export const APPEARANCE_STORAGE_KEYS = {
  theme: 'chamber.theme',
  fontScale: 'chamber.fontScale',
  density: 'chamber.density',
} as const;

const FONT_SCALE_CLASSES: Record<FontScale, string> = {
  small: 'font-scale-small',
  medium: 'font-scale-medium',
  large: 'font-scale-large',
};

const DENSITY_CLASSES: Record<Density, string> = {
  comfortable: 'density-comfortable',
  compact: 'density-compact',
};

/** The `matchMedia` query used to detect the OS dark color-scheme preference. */
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';
export const INITIAL_APPEARANCE_GLOBAL = '__CHAMBER_INITIAL_APPEARANCE__';

// Keep aligned with the 450ms color transition in index.css so the
// `theme-switching` class clears exactly as the crossfade ends.
const THEME_TRANSITION_MS = 450;

// ---------------------------------------------------------------------------
// Generic persistence
// ---------------------------------------------------------------------------

function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    return (allowed as readonly string[]).includes(stored ?? '') ? (stored as T) : fallback;
  } catch {
    return fallback;
  }
}

function persistChoice(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable */
  }
}

/** Swap the single active class from `classes` on the document root. */
function applyRootClass(classes: readonly string[], active: string): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove(...classes);
  root.classList.add(active);
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export function readStoredThemePreference(): ThemePreference {
  return readChoice(APPEARANCE_STORAGE_KEYS.theme, THEME_PREFERENCES, DEFAULT_THEME_PREFERENCE);
}

export function persistThemePreference(preference: ThemePreference): void {
  persistChoice(APPEARANCE_STORAGE_KEYS.theme, preference);
}

/** Whether the OS currently reports a dark color-scheme preference. */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  return resolveThemePreference(preference, prefersDark);
}

export interface ApplyThemeOptions {
  /** Play the global crossfade transition. Off for the first paint on load. */
  readonly animate?: boolean;
}

export function applyResolvedTheme(resolved: ResolvedTheme, options: ApplyThemeOptions = {}): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (options.animate) {
    // Mark the document as "mid-swap" so the global color transition kicks in
    // just for this paint, then clear it once the crossfade ends.
    root.classList.add('theme-switching');
    window.setTimeout(() => root.classList.remove('theme-switching'), THEME_TRANSITION_MS);
  }
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
  // Legacy fallback for desktop shells without the ConfigService-backed
  // appearance bridge. New desktop builds repaint chrome from AppearanceService.
  try {
    if (!hasDesktopAppearanceBridge()) void window.desktop?.setTheme?.(resolved);
  } catch {
    /* desktop bridge may not be present in browser smoke tests */
  }
}

export function applyAppearanceSnapshot(snapshot: AppearanceSnapshot, options: ApplyThemeOptions = {}): void {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.themePreference = snapshot.themePreference;
  }
  applyResolvedTheme(snapshot.resolvedTheme, options);
  applyFontScale(snapshot.fontScale);
  applyDensity(snapshot.density);
}

// ---------------------------------------------------------------------------
// Font scale
// ---------------------------------------------------------------------------

export function readStoredFontScale(): FontScale {
  return readChoice(APPEARANCE_STORAGE_KEYS.fontScale, FONT_SCALES, DEFAULT_FONT_SCALE);
}

export function persistFontScale(scale: FontScale): void {
  persistChoice(APPEARANCE_STORAGE_KEYS.fontScale, scale);
}

export function applyFontScale(scale: FontScale): void {
  applyRootClass(Object.values(FONT_SCALE_CLASSES), FONT_SCALE_CLASSES[scale]);
}

// ---------------------------------------------------------------------------
// Density
// ---------------------------------------------------------------------------

export function readStoredDensity(): Density {
  return readChoice(APPEARANCE_STORAGE_KEYS.density, DENSITIES, DEFAULT_DENSITY);
}

export function persistDensity(density: Density): void {
  persistChoice(APPEARANCE_STORAGE_KEYS.density, density);
}

export function applyDensity(density: Density): void {
  applyRootClass(Object.values(DENSITY_CLASSES), DENSITY_CLASSES[density]);
}

export function readBrowserAppearanceSnapshot(): AppearanceSnapshot {
  const themePreference = readStoredThemePreference();
  return {
    themePreference,
    resolvedTheme: resolveTheme(themePreference, systemPrefersDark()),
    fontScale: readStoredFontScale(),
    density: readStoredDensity(),
  };
}

export function readInitialAppearanceSnapshot(): AppearanceSnapshot {
  if (typeof window !== 'undefined') {
    const prepaintSnapshot = window[INITIAL_APPEARANCE_GLOBAL];
    if (isAppearanceSnapshot(prepaintSnapshot)) return prepaintSnapshot;

    const bridgeSnapshot = window.chamberAppearance?.getInitialSnapshot?.();
    if (isAppearanceSnapshot(bridgeSnapshot)) return bridgeSnapshot;
  }
  return readBrowserAppearanceSnapshot();
}

export function hasDesktopAppearanceBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.chamberAppearance?.set === 'function';
}

export function persistAppearancePatch(patch: Partial<AppearancePreferences>): Promise<AppearanceSnapshot | null> {
  if (hasDesktopAppearanceBridge()) {
    return window.chamberAppearance!.set(patch);
  }

  if (patch.themePreference) persistThemePreference(patch.themePreference);
  if (patch.fontScale) persistFontScale(patch.fontScale);
  if (patch.density) persistDensity(patch.density);
  return Promise.resolve(null);
}

export function subscribeDesktopAppearance(callback: (snapshot: AppearanceSnapshot) => void): (() => void) | null {
  if (!hasDesktopAppearanceBridge()) return null;
  return window.chamberAppearance!.onChanged(callback);
}
