/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDensity, useFontScale } from './useAppearance';
import { APPEARANCE_STORAGE_KEYS } from '../lib/appearance';

describe('useFontScale', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  afterEach(() => {
    document.documentElement.className = '';
  });

  it('starts from the persisted scale and applies it', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.fontScale, 'large');

    const { result } = renderHook(() => useFontScale());

    expect(result.current.fontScale).toBe('large');
    expect(document.documentElement.classList.contains('font-scale-large')).toBe(true);
  });

  it('applies and persists a change', () => {
    const { result } = renderHook(() => useFontScale());

    act(() => result.current.setFontScale('small'));

    expect(document.documentElement.classList.contains('font-scale-small')).toBe(true);
    expect(document.documentElement.classList.contains('font-scale-medium')).toBe(false);
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEYS.fontScale)).toBe('small');
  });

  it('mirrors a change made in another window', () => {
    const { result } = renderHook(() => useFontScale());

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: APPEARANCE_STORAGE_KEYS.fontScale, newValue: 'large' }),
      );
    });

    expect(result.current.fontScale).toBe('large');
    expect(document.documentElement.classList.contains('font-scale-large')).toBe(true);
  });
});

describe('useDensity', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  afterEach(() => {
    document.documentElement.className = '';
  });

  it('starts from the persisted density and applies it', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEYS.density, 'compact');

    const { result } = renderHook(() => useDensity());

    expect(result.current.density).toBe('compact');
    expect(document.documentElement.classList.contains('density-compact')).toBe(true);
  });

  it('applies and persists a change', () => {
    const { result } = renderHook(() => useDensity());

    act(() => result.current.setDensity('compact'));

    expect(document.documentElement.classList.contains('density-compact')).toBe(true);
    expect(document.documentElement.classList.contains('density-comfortable')).toBe(false);
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEYS.density)).toBe('compact');
  });
});
