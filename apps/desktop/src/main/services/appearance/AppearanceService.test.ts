import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceService, type NativeThemeAdapter } from './AppearanceService';
import type { AppearancePreferences } from '@chamber/shared/appearance-types';

class FakeNativeTheme implements NativeThemeAdapter {
  shouldUseDarkColors = true;
  private readonly listeners = new Set<() => void>();

  on(_event: 'updated', listener: () => void): void {
    this.listeners.add(listener);
  }

  off(_event: 'updated', listener: () => void): void {
    this.listeners.delete(listener);
  }

  emitUpdated(): void {
    for (const listener of this.listeners) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

class FakeConfigService {
  preferences: AppearancePreferences = {
    themePreference: 'dark',
    fontScale: 'medium',
    density: 'comfortable',
  };

  getAppearancePreferences(): AppearancePreferences {
    return { ...this.preferences };
  }

  saveAppearancePreferences(preferences: AppearancePreferences): void {
    this.preferences = { ...preferences };
  }
}

describe('AppearanceService', () => {
  let config: FakeConfigService;
  let nativeTheme: FakeNativeTheme;
  let service: AppearanceService;

  beforeEach(() => {
    config = new FakeConfigService();
    nativeTheme = new FakeNativeTheme();
    service = new AppearanceService(config, nativeTheme);
  });

  it('returns the persisted preferences with a resolved theme', () => {
    config.preferences = {
      themePreference: 'system',
      fontScale: 'large',
      density: 'compact',
    };
    nativeTheme.shouldUseDarkColors = false;

    expect(service.getSnapshot()).toEqual({
      themePreference: 'system',
      resolvedTheme: 'light',
      fontScale: 'large',
      density: 'compact',
    });
  });

  it('persists preferences only and computes the resolved theme on read', () => {
    nativeTheme.shouldUseDarkColors = true;

    const snapshot = service.setPreferences({
      themePreference: 'system',
      fontScale: 'small',
    });

    expect(config.preferences).toEqual({
      themePreference: 'system',
      fontScale: 'small',
      density: 'comfortable',
    });
    expect(snapshot).toEqual({
      themePreference: 'system',
      resolvedTheme: 'dark',
      fontScale: 'small',
      density: 'comfortable',
    });
  });

  it('broadcasts preference changes', () => {
    const listener = vi.fn();
    service.subscribe(listener);

    service.setThemePreference('light');

    expect(listener).toHaveBeenCalledWith({
      themePreference: 'light',
      resolvedTheme: 'light',
      fontScale: 'medium',
      density: 'comfortable',
    });
  });

  it('follows OS changes only while the theme preference is system', () => {
    const listener = vi.fn();
    service.subscribe(listener);

    service.setThemePreference('dark');
    listener.mockClear();
    nativeTheme.shouldUseDarkColors = false;
    nativeTheme.emitUpdated();
    expect(listener).not.toHaveBeenCalled();

    service.setThemePreference('system');
    listener.mockClear();
    nativeTheme.shouldUseDarkColors = false;
    nativeTheme.emitUpdated();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      themePreference: 'system',
      resolvedTheme: 'light',
    }));
  });

  it('detaches native theme listeners on dispose', () => {
    expect(nativeTheme.listenerCount()).toBe(1);

    service.dispose();

    expect(nativeTheme.listenerCount()).toBe(0);
  });
});
