import { lensViewVisibilityKey, parseLensViewVisibilityKey } from '@chamber/shared';
import type { AppConfig, LensViewVisibility } from '@chamber/shared/types';
import type { ConfigService } from '../config/ConfigService';

type ConfigStore = Pick<ConfigService, 'load' | 'save'>;

export class LensPreferencesService {
  constructor(private readonly configService: ConfigStore) {}

  isViewEnabled(mindId: string, viewId: string): boolean {
    assertNonEmpty(mindId, 'mindId');
    assertNonEmpty(viewId, 'viewId');
    return !this.disabledKeySet().has(lensViewVisibilityKey(mindId, viewId));
  }

  getDisabledViewIds(mindId: string): string[] {
    assertNonEmpty(mindId, 'mindId');
    const viewIds: string[] = [];
    for (const key of this.configService.load().disabledLensViewKeys ?? []) {
      const parsed = parseLensViewVisibilityKey(key);
      if (parsed?.mindId === mindId) viewIds.push(parsed.viewId);
    }
    return viewIds;
  }

  setViewEnabled(mindId: string, viewId: string, enabled: boolean): LensViewVisibility {
    assertNonEmpty(mindId, 'mindId');
    assertNonEmpty(viewId, 'viewId');
    const config = this.configService.load();
    const disabledKeys = new Set(config.disabledLensViewKeys ?? []);
    const key = lensViewVisibilityKey(mindId, viewId);

    if (enabled) {
      disabledKeys.delete(key);
    } else {
      disabledKeys.add(key);
    }

    this.configService.save(withDisabledLensViewKeys(config, [...disabledKeys]));
    return { mindId, viewId, enabled };
  }

  cleanupMissingMinds(mindIds: readonly string[]): void {
    const keepMindIds = new Set(mindIds);
    const config = this.configService.load();
    const existingKeys = config.disabledLensViewKeys ?? [];
    const nextKeys = existingKeys.filter((key) => {
      const parsed = parseLensViewVisibilityKey(key);
      return parsed ? keepMindIds.has(parsed.mindId) : false;
    });
    if (nextKeys.length === existingKeys.length) return;
    this.configService.save(withDisabledLensViewKeys(config, nextKeys));
  }

  private disabledKeySet(): Set<string> {
    return new Set(this.configService.load().disabledLensViewKeys ?? []);
  }
}

function withDisabledLensViewKeys(config: AppConfig, keys: string[]): AppConfig {
  const nextKeys = [...new Set(keys)].sort();
  const nextConfig: AppConfig = { ...config };
  if (nextKeys.length === 0) {
    delete nextConfig.disabledLensViewKeys;
  } else {
    nextConfig.disabledLensViewKeys = nextKeys;
  }
  return nextConfig;
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}
