/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_STORAGE_KEYS,
  applyAppearanceSnapshot,
  applyDensity,
  applyFontScale,
  applyResolvedTheme,
  hasDesktopAppearanceBridge,
  isThemePreference,
  persistAppearancePatch,
  readInitialAppearanceSnapshot,
  readStoredDensity,
  readStoredFontScale,
  readStoredThemePreference,
  resolveTheme,
  systemPrefersDark,
} from './appearance';
import type { AppearanceBridge } from '@chamber/shared/electron-types';

function setMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('dark') ? prefersDark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

describe('appearance preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    delete document.documentElement.dataset.theme;
    delete window.__CHAMBER_INITIAL_APPEARANCE__;
    delete window.chamberAppearance;
    delete window.desktop;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete window.desktop;
  });

  describe('resolveTheme', () => {
    it('passes explicit light and dark preferences through unchanged', () => {
      expect(resolveTheme('light', true)).toBe('light');
      expect(resolveTheme('dark', false)).toBe('dark');
    });

    it('resolves system to the OS scheme', () => {
      expect(resolveTheme('system', true)).toBe('dark');
      expect(resolveTheme('system', false)).toBe('light');
    });
  });

  describe('readStoredThemePreference', () => {
    it('defaults to dark when nothing is stored', () => {
      expect(readStoredThemePreference()).toBe('dark');
    });

    it('reads a valid stored preference', () => {
      localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, 'system');
      expect(readStoredThemePreference()).toBe('system');
    });

    it('falls back to the default for an unrecognized value', () => {
      localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, 'neon');
      expect(readStoredThemePreference()).toBe('dark');
    });
  });

  describe('isThemePreference', () => {
    it('accepts the three known preferences and rejects everything else', () => {
      expect(isThemePreference('light')).toBe(true);
      expect(isThemePreference('dark')).toBe(true);
      expect(isThemePreference('system')).toBe(true);
      expect(isThemePreference('bright')).toBe(false);
      expect(isThemePreference(null)).toBe(false);
    });
  });

  describe('systemPrefersDark', () => {
    it('reflects the OS media query', () => {
      setMatchMedia(false);
      expect(systemPrefersDark()).toBe(false);
      setMatchMedia(true);
      expect(systemPrefersDark()).toBe(true);
    });
  });

  describe('applyResolvedTheme', () => {
    it('toggles the dark class and records the theme without animating by default', () => {
      applyResolvedTheme('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement.classList.contains('theme-switching')).toBe(false);

      applyResolvedTheme('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    describe('initial snapshot and desktop bridge', () => {
      it('reads the pre-paint snapshot before falling back to storage', () => {
        window.__CHAMBER_INITIAL_APPEARANCE__ = {
          themePreference: 'light',
          resolvedTheme: 'light',
          fontScale: 'large',
          density: 'compact',
        };
        localStorage.setItem(APPEARANCE_STORAGE_KEYS.theme, 'dark');

        expect(readInitialAppearanceSnapshot()).toEqual({
          themePreference: 'light',
          resolvedTheme: 'light',
          fontScale: 'large',
          density: 'compact',
        });
      });

      it('delegates persistence to the desktop bridge when available', async () => {
        const set = vi.fn<AppearanceBridge['set']>().mockResolvedValue({
          themePreference: 'system',
          resolvedTheme: 'dark',
          fontScale: 'medium',
          density: 'comfortable',
        });
        window.chamberAppearance = {
          getInitialSnapshot: () => ({
            themePreference: 'dark',
            resolvedTheme: 'dark',
            fontScale: 'medium',
            density: 'comfortable',
          }),
          get: vi.fn(),
          set,
          onChanged: vi.fn(),
        };

        await persistAppearancePatch({ themePreference: 'system' });

        expect(hasDesktopAppearanceBridge()).toBe(true);
        expect(set).toHaveBeenCalledWith({ themePreference: 'system' });
        expect(localStorage.getItem(APPEARANCE_STORAGE_KEYS.theme)).toBeNull();
      });

      it('applies a complete snapshot to root classes and data attributes', () => {
        applyAppearanceSnapshot({
          themePreference: 'system',
          resolvedTheme: 'light',
          fontScale: 'small',
          density: 'compact',
        });

        const root = document.documentElement;
        expect(root.classList.contains('dark')).toBe(false);
        expect(root.classList.contains('font-scale-small')).toBe(true);
        expect(root.classList.contains('density-compact')).toBe(true);
        expect(root.dataset.theme).toBe('light');
        expect(root.dataset.themePreference).toBe('system');
      });
    });

    it('adds the transition class when animating', () => {
      applyResolvedTheme('dark', { animate: true });
      expect(document.documentElement.classList.contains('theme-switching')).toBe(true);
    });

    it('uses the legacy desktop repaint bridge only when the appearance bridge is absent', () => {
      const setTheme = vi.fn();
      window.desktop = {
        pickFolder: vi.fn(),
        openMindWindow: vi.fn(),
        setTheme,
      };

      applyResolvedTheme('light');
      expect(setTheme).toHaveBeenCalledWith('light');

      window.chamberAppearance = {
        getInitialSnapshot: () => ({
          themePreference: 'light',
          resolvedTheme: 'light',
          fontScale: 'medium',
          density: 'comfortable',
        }),
        get: vi.fn(),
        set: vi.fn(),
        onChanged: vi.fn(),
      };
      setTheme.mockClear();

      applyResolvedTheme('dark');

      expect(setTheme).not.toHaveBeenCalled();
    });
  });

  describe('applyFontScale', () => {
    it('applies exactly one font-scale class', () => {
      applyFontScale('large');
      expect(document.documentElement.classList.contains('font-scale-large')).toBe(true);

      applyFontScale('small');
      expect(document.documentElement.classList.contains('font-scale-small')).toBe(true);
      expect(document.documentElement.classList.contains('font-scale-large')).toBe(false);
    });
  });

  describe('applyDensity', () => {
    it('applies exactly one density class', () => {
      applyDensity('compact');
      expect(document.documentElement.classList.contains('density-compact')).toBe(true);

      applyDensity('comfortable');
      expect(document.documentElement.classList.contains('density-comfortable')).toBe(true);
      expect(document.documentElement.classList.contains('density-compact')).toBe(false);
    });
  });

  describe('readStoredFontScale / readStoredDensity', () => {
    it('default to medium and comfortable', () => {
      expect(readStoredFontScale()).toBe('medium');
      expect(readStoredDensity()).toBe('comfortable');
    });
  });
});
