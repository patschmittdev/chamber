/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePersistedCollapse } from './usePersistedCollapse';

const KEY = 'chamber:test-collapse';

describe('usePersistedCollapse', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('defaults to expanded when nothing is stored', () => {
    const { result } = renderHook(() => usePersistedCollapse(KEY));
    expect(result.current[0]).toBe(false);
  });

  it('restores a stored collapsed preference', () => {
    localStorage.setItem(KEY, 'true');
    const { result } = renderHook(() => usePersistedCollapse(KEY));
    expect(result.current[0]).toBe(true);
  });

  it('persists updates to localStorage', () => {
    const { result } = renderHook(() => usePersistedCollapse(KEY));

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('true');

    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('false');
  });
});
