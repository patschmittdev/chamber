/**
 * Appearance store: the always-on owner of runtime appearance synchronization.
 *
 * Started once from the renderer entry (not from any screen), it holds the
 * current preferences, applies them to the document, and keeps browser mode in
 * sync with OS and localStorage changes. Desktop mode delegates persistence and
 * OS-following to the preload appearance bridge backed by ConfigService.
 *
 * React consumes it through `useSyncExternalStore` (see the appearance hooks).
 * Settings only reads the snapshot and calls the setters; it never owns the
 * ongoing synchronization.
 */

import {
  APPEARANCE_STORAGE_KEYS,
  applyAppearanceSnapshot,
  DARK_MEDIA_QUERY,
  hasDesktopAppearanceBridge,
  isDensity,
  isFontScale,
  isThemePreference,
  persistAppearancePatch,
  persistDensity,
  persistFontScale,
  persistThemePreference,
  readInitialAppearanceSnapshot,
  resolveTheme,
  subscribeDesktopAppearance,
  systemPrefersDark,
  type Density,
  type FontScale,
  type ResolvedTheme,
  type ThemePreference,
} from './appearance';

export interface AppearanceState {
  readonly themePreference: ThemePreference;
  /** The concrete theme currently painted; never `system`. */
  readonly resolvedTheme: ResolvedTheme;
  readonly fontScale: FontScale;
  readonly density: Density;
}

type Listener = () => void;

class AppearanceStore {
  private snapshot: AppearanceState = readInitialAppearanceSnapshot();
  private themePreference: ThemePreference = this.snapshot.themePreference;
  private fontScale: FontScale = this.snapshot.fontScale;
  private density: Density = this.snapshot.density;
  private prefersDark: boolean = systemPrefersDark();
  private readonly listeners = new Set<Listener>();
  private mediaQuery: MediaQueryList | null = null;
  private desktopUnsubscribe: (() => void) | null = null;
  private started = false;

  private readonly handleMedia = (event: MediaQueryListEvent): void => {
    this.prefersDark = event.matches;
    // The OS scheme only changes the resolved theme when following `system`;
    // for an explicit light/dark preference there is nothing to repaint.
    if (this.themePreference !== 'system') return;
    this.applyTheme(true);
    this.publish();
  };

  private readonly handleStorage = (event: StorageEvent): void => {
    if (event.key === APPEARANCE_STORAGE_KEYS.theme && isThemePreference(event.newValue)) {
      this.themePreference = event.newValue;
      this.applyTheme(true);
      this.publish();
    } else if (event.key === APPEARANCE_STORAGE_KEYS.fontScale && isFontScale(event.newValue)) {
      this.fontScale = event.newValue;
      this.applySnapshot(false);
      this.publish();
    } else if (event.key === APPEARANCE_STORAGE_KEYS.density && isDensity(event.newValue)) {
      this.density = event.newValue;
      this.applySnapshot(false);
      this.publish();
    }
  };

  /**
   * Apply the persisted preferences and begin listening for OS and cross-window
   * changes. Idempotent: safe to call once at startup. The initial paint skips
   * the theme crossfade so loading the app does not animate.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.isDesktopMode()) {
      this.acceptSnapshot(readInitialAppearanceSnapshot(), false, false);
      this.desktopUnsubscribe = subscribeDesktopAppearance((snapshot) => {
        this.acceptSnapshot(snapshot, true, true);
      });
      return;
    }

    this.applySnapshot(false);
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.mediaQuery = window.matchMedia(DARK_MEDIA_QUERY);
      this.mediaQuery.addEventListener('change', this.handleMedia);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.handleStorage);
    }
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AppearanceState => this.snapshot;

  setThemePreference = (preference: ThemePreference): void => {
    if (this.isDesktopMode()) {
      this.persistDesktop({ themePreference: preference });
      return;
    }
    this.themePreference = preference;
    persistThemePreference(preference);
    this.applyTheme(true);
    this.publish();
  };

  toggleTheme = (): void => {
    const shown = this.snapshot.resolvedTheme;
    this.setThemePreference(shown === 'dark' ? 'light' : 'dark');
  };

  setFontScale = (scale: FontScale): void => {
    if (this.isDesktopMode()) {
      this.persistDesktop({ fontScale: scale });
      return;
    }
    this.fontScale = scale;
    persistFontScale(scale);
    this.applySnapshot(false);
    this.publish();
  };

  setDensity = (density: Density): void => {
    if (this.isDesktopMode()) {
      this.persistDesktop({ density });
      return;
    }
    this.density = density;
    persistDensity(density);
    this.applySnapshot(false);
    this.publish();
  };

  private applyTheme(animate: boolean): void {
    applyAppearanceSnapshot(this.computeSnapshot(), { animate });
  }

  private applySnapshot(animate: boolean): void {
    applyAppearanceSnapshot(this.computeSnapshot(), { animate });
  }

  private computeSnapshot(): AppearanceState {
    return {
      themePreference: this.themePreference,
      resolvedTheme: resolveTheme(this.themePreference, this.prefersDark),
      fontScale: this.fontScale,
      density: this.density,
    };
  }

  private publish(): void {
    this.publishSnapshot(this.computeSnapshot());
  }

  private publishSnapshot(snapshot: AppearanceState): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private acceptSnapshot(snapshot: AppearanceState, animate: boolean, notify: boolean): void {
    this.themePreference = snapshot.themePreference;
    this.fontScale = snapshot.fontScale;
    this.density = snapshot.density;
    this.snapshot = snapshot;
    applyAppearanceSnapshot(snapshot, { animate });
    if (notify) this.publishSnapshot(snapshot);
  }

  private persistDesktop(patch: Parameters<typeof persistAppearancePatch>[0]): void {
    void persistAppearancePatch(patch)
      .then((snapshot) => {
        if (snapshot) this.acceptSnapshot(snapshot, true, true);
      })
      .catch((error: unknown) => {
        console.error('Failed to persist desktop appearance preferences:', error);
      });
  }

  private isDesktopMode(): boolean {
    return hasDesktopAppearanceBridge();
  }

  /**
   * Detach listeners and re-read persisted state. Intended for tests so each
   * case starts from a clean, storage-derived snapshot.
   */
  resetForTests(): void {
    this.mediaQuery?.removeEventListener('change', this.handleMedia);
    if (typeof window !== 'undefined') window.removeEventListener('storage', this.handleStorage);
    this.desktopUnsubscribe?.();
    this.desktopUnsubscribe = null;
    this.mediaQuery = null;
    this.started = false;
    this.listeners.clear();
    const snapshot = readInitialAppearanceSnapshot();
    this.themePreference = snapshot.themePreference;
    this.fontScale = snapshot.fontScale;
    this.density = snapshot.density;
    this.prefersDark = systemPrefersDark();
    this.snapshot = this.isDesktopMode() ? snapshot : this.computeSnapshot();
  }
}

export const appearanceStore = new AppearanceStore();

/** Begin app-wide appearance synchronization. Call once from the renderer entry. */
export function startAppearanceSync(): void {
  appearanceStore.start();
}
