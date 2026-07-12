import type { ConfigService } from '@chamber/services';
import {
  resolveThemePreference,
  type AppearancePreferences,
  type AppearanceSnapshot,
  type Density,
  type FontScale,
  type ThemePreference,
} from '@chamber/shared/appearance-types';

export interface NativeThemeAdapter {
  readonly shouldUseDarkColors: boolean;
  on(event: 'updated', listener: () => void): void;
  off(event: 'updated', listener: () => void): void;
}

type AppearanceListener = (snapshot: AppearanceSnapshot) => void;

export class AppearanceService {
  private readonly listeners = new Set<AppearanceListener>();
  private readonly handleNativeThemeUpdated = (): void => {
    if (this.configService.getAppearancePreferences().themePreference !== 'system') return;
    this.publish();
  };

  constructor(
    private readonly configService: Pick<ConfigService, 'getAppearancePreferences' | 'saveAppearancePreferences'>,
    private readonly nativeTheme: NativeThemeAdapter,
  ) {
    this.nativeTheme.on('updated', this.handleNativeThemeUpdated);
  }

  getSnapshot(): AppearanceSnapshot {
    return this.toSnapshot(this.configService.getAppearancePreferences());
  }

  setPreferences(patch: Partial<AppearancePreferences>): AppearanceSnapshot {
    const current = this.configService.getAppearancePreferences();
    const next = {
      themePreference: patch.themePreference ?? current.themePreference,
      fontScale: patch.fontScale ?? current.fontScale,
      density: patch.density ?? current.density,
    };
    this.configService.saveAppearancePreferences(next);
    const snapshot = this.toSnapshot(next);
    this.publish(snapshot);
    return snapshot;
  }

  setThemePreference(themePreference: ThemePreference): AppearanceSnapshot {
    return this.setPreferences({ themePreference });
  }

  setFontScale(fontScale: FontScale): AppearanceSnapshot {
    return this.setPreferences({ fontScale });
  }

  setDensity(density: Density): AppearanceSnapshot {
    return this.setPreferences({ density });
  }

  subscribe(listener: AppearanceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.nativeTheme.off('updated', this.handleNativeThemeUpdated);
    this.listeners.clear();
  }

  private toSnapshot(preferences: AppearancePreferences): AppearanceSnapshot {
    return {
      ...preferences,
      resolvedTheme: resolveThemePreference(preferences.themePreference, this.nativeTheme.shouldUseDarkColors),
    };
  }

  private publish(snapshot = this.getSnapshot()): void {
    for (const listener of this.listeners) listener(snapshot);
  }
}
