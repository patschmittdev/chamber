export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = typeof THEME_PREFERENCES[number];

export const RESOLVED_THEMES = ['light', 'dark'] as const;
export type ResolvedTheme = typeof RESOLVED_THEMES[number];

export const FONT_SCALES = ['small', 'medium', 'large'] as const;
export type FontScale = typeof FONT_SCALES[number];

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = typeof DENSITIES[number];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';
export const DEFAULT_RESOLVED_THEME: ResolvedTheme = 'dark';
export const DEFAULT_FONT_SCALE: FontScale = 'medium';
export const DEFAULT_DENSITY: Density = 'comfortable';

export interface AppearancePreferences {
  readonly themePreference: ThemePreference;
  readonly fontScale: FontScale;
  readonly density: Density;
}

export interface AppearanceSnapshot extends AppearancePreferences {
  readonly resolvedTheme: ResolvedTheme;
}

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  themePreference: DEFAULT_THEME_PREFERENCE,
  fontScale: DEFAULT_FONT_SCALE,
  density: DEFAULT_DENSITY,
};

export const DEFAULT_APPEARANCE_SNAPSHOT: AppearanceSnapshot = {
  ...DEFAULT_APPEARANCE_PREFERENCES,
  resolvedTheme: DEFAULT_RESOLVED_THEME,
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function isResolvedTheme(value: unknown): value is ResolvedTheme {
  return typeof value === 'string' && (RESOLVED_THEMES as readonly string[]).includes(value);
}

export function isFontScale(value: unknown): value is FontScale {
  return typeof value === 'string' && (FONT_SCALES as readonly string[]).includes(value);
}

export function isDensity(value: unknown): value is Density {
  return typeof value === 'string' && (DENSITIES as readonly string[]).includes(value);
}

export function normalizeThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

export function normalizeFontScale(value: unknown): FontScale {
  return isFontScale(value) ? value : DEFAULT_FONT_SCALE;
}

export function normalizeDensity(value: unknown): Density {
  return isDensity(value) ? value : DEFAULT_DENSITY;
}

export function resolveThemePreference(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light';
  return preference;
}

export function isAppearanceSnapshot(value: unknown): value is AppearanceSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isThemePreference(record.themePreference)
    && isResolvedTheme(record.resolvedTheme)
    && isFontScale(record.fontScale)
    && isDensity(record.density);
}
