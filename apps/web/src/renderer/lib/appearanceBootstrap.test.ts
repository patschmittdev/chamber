/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AppearanceBridge } from '@chamber/shared/electron-types';

const bootstrapSource = readFileSync(
  path.join(process.cwd(), 'apps', 'web', 'public', 'appearance-bootstrap.js'),
  'utf8',
);

describe('appearance-bootstrap.js', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-preference');
    document.documentElement.removeAttribute('data-font-scale');
    document.documentElement.removeAttribute('data-density');
    delete window.__CHAMBER_INITIAL_APPEARANCE__;
    delete window.chamberAppearance;
    vi.restoreAllMocks();
  });

  it('uses the desktop preload snapshot before localStorage', () => {
    localStorage.setItem('chamber.theme', 'dark');
    window.chamberAppearance = {
      getInitialSnapshot: () => ({
        themePreference: 'light',
        resolvedTheme: 'light',
        fontScale: 'large',
        density: 'compact',
      }),
      get: vi.fn(),
      set: vi.fn(),
      onChanged: vi.fn(),
    } as AppearanceBridge;

    runBootstrap();

    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.classList.contains('font-scale-large')).toBe(true);
    expect(root.classList.contains('density-compact')).toBe(true);
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.themePreference).toBe('light');
    expect(window.__CHAMBER_INITIAL_APPEARANCE__).toEqual({
      themePreference: 'light',
      resolvedTheme: 'light',
      fontScale: 'large',
      density: 'compact',
    });
  });

  it('keeps browser mode backed by localStorage and resolves system from matchMedia', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false }),
    });
    localStorage.setItem('chamber.theme', 'system');
    localStorage.setItem('chamber.fontScale', 'small');
    localStorage.setItem('chamber.density', 'compact');

    runBootstrap();

    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.classList.contains('font-scale-small')).toBe(true);
    expect(root.classList.contains('density-compact')).toBe(true);
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.themePreference).toBe('system');
    expect(window.__CHAMBER_INITIAL_APPEARANCE__).toEqual({
      themePreference: 'system',
      resolvedTheme: 'light',
      fontScale: 'small',
      density: 'compact',
    });
  });
});

function runBootstrap(): void {
  window.eval(bootstrapSource);
}
