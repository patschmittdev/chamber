import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@chamber/shared/types';
import { LensPreferencesService } from './LensPreferencesService';

const baseConfig: AppConfig = {
  version: 2,
  minds: [
    { id: 'mind-a', path: 'C:\\minds\\a' },
    { id: 'mind-b', path: 'C:\\minds\\b' },
  ],
  activeMindId: 'mind-a',
  activeLogin: null,
  theme: 'dark',
};

function createService(config: AppConfig = baseConfig) {
  let currentConfig = { ...config };
  const store = {
    load: vi.fn(() => currentConfig),
    save: vi.fn((next: AppConfig) => {
      currentConfig = next;
    }),
  };
  return {
    service: new LensPreferencesService(store),
    store,
    getConfig: () => currentConfig,
  };
}

describe('LensPreferencesService', () => {
  it('defaults discovered Lens views to enabled', () => {
    const { service } = createService();

    expect(service.isViewEnabled('mind-a', 'briefing')).toBe(true);
    expect(service.getDisabledViewIds('mind-a')).toEqual([]);
  });

  it('persists disable and re-enable preferences', () => {
    const { service, store, getConfig } = createService();

    expect(service.setViewEnabled('mind-a', 'briefing', false)).toEqual({
      mindId: 'mind-a',
      viewId: 'briefing',
      enabled: false,
    });
    expect(getConfig().disabledLensViewKeys).toEqual(['mind-a:briefing']);
    expect(service.isViewEnabled('mind-a', 'briefing')).toBe(false);

    expect(service.setViewEnabled('mind-a', 'briefing', true)).toEqual({
      mindId: 'mind-a',
      viewId: 'briefing',
      enabled: true,
    });
    expect(getConfig().disabledLensViewKeys).toBeUndefined();
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('removes disabled Lens preferences for missing minds', () => {
    const { service, getConfig } = createService({
      ...baseConfig,
      disabledLensViewKeys: ['mind-a:briefing', 'mind-b:briefing'],
    });

    service.cleanupMissingMinds(['mind-a']);

    expect(getConfig().disabledLensViewKeys).toEqual(['mind-a:briefing']);
  });

  it('keeps duplicate view ids isolated by mind id', () => {
    const { service } = createService();

    service.setViewEnabled('mind-a', 'briefing', false);

    expect(service.isViewEnabled('mind-a', 'briefing')).toBe(false);
    expect(service.isViewEnabled('mind-b', 'briefing')).toBe(true);
    expect(service.getDisabledViewIds('mind-a')).toEqual(['briefing']);
    expect(service.getDisabledViewIds('mind-b')).toEqual([]);
  });

  it('keeps delimiter-bearing mind and view ids collision-safe', () => {
    const { service, getConfig } = createService();

    service.setViewEnabled('team:alpha', 'daily:briefing', false);

    expect(getConfig().disabledLensViewKeys).toEqual(['team%3Aalpha:daily%3Abriefing']);
    expect(service.isViewEnabled('team:alpha', 'daily:briefing')).toBe(false);
    expect(service.isViewEnabled('team', 'alpha:daily:briefing')).toBe(true);
    expect(service.getDisabledViewIds('team:alpha')).toEqual(['daily:briefing']);
    expect(service.getDisabledViewIds('team')).toEqual([]);
  });
});
