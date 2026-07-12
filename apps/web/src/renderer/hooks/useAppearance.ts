import { useCallback, useEffect, useState } from 'react';
import {
  APPEARANCE_STORAGE_KEYS,
  applyDensity,
  applyFontScale,
  DENSITIES,
  FONT_SCALES,
  persistDensity,
  persistFontScale,
  readStoredDensity,
  readStoredFontScale,
  type Density,
  type FontScale,
} from '../lib/appearance';

export type { FontScale, Density } from '../lib/appearance';

/**
 * Shared machinery for a preference that maps to a document-root class: it reads
 * an initial value from storage, applies it live, persists changes, and mirrors
 * changes made in other windows. Powers both the font-scale and density hooks so
 * their behavior stays identical. All collaborators are module-level stable
 * references, so the effects below never re-subscribe on re-render.
 */
function usePersistedRootClass<T extends string>(
  read: () => T,
  apply: (value: T) => void,
  persist: (value: T) => void,
  storageKey: string,
  allowed: readonly T[],
): readonly [T, (value: T) => void] {
  const [value, setValue] = useState<T>(read);

  useEffect(() => {
    apply(value);
  }, [apply, value]);

  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === storageKey && (allowed as readonly string[]).includes(event.newValue ?? '')) {
        setValue(event.newValue as T);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [allowed, storageKey]);

  const set = useCallback((next: T) => {
    setValue(next);
    persist(next);
  }, [persist]);

  return [value, set] as const;
}

export interface UseFontScaleResult {
  readonly fontScale: FontScale;
  readonly setFontScale: (scale: FontScale) => void;
}

/** Reads, applies, and persists the interface font-scale preference. */
export function useFontScale(): UseFontScaleResult {
  const [fontScale, setFontScale] = usePersistedRootClass(
    readStoredFontScale,
    applyFontScale,
    persistFontScale,
    APPEARANCE_STORAGE_KEYS.fontScale,
    FONT_SCALES,
  );
  return { fontScale, setFontScale };
}

export interface UseDensityResult {
  readonly density: Density;
  readonly setDensity: (density: Density) => void;
}

/** Reads, applies, and persists the interface density preference. */
export function useDensity(): UseDensityResult {
  const [density, setDensity] = usePersistedRootClass(
    readStoredDensity,
    applyDensity,
    persistDensity,
    APPEARANCE_STORAGE_KEYS.density,
    DENSITIES,
  );
  return { density, setDensity };
}
