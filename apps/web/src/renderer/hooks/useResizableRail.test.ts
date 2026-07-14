/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type * as React from 'react';
import { useResizableRail } from './useResizableRail';

const baseOptions = {
  defaultWidth: 280,
  label: 'Resize test panel',
  maxWidth: 400,
  minWidth: 200,
  side: 'left' as const,
  storageKey: 'test:resizable-rail',
};

function keyEvent(key: string) {
  const preventDefault = vi.fn();
  const event = { key, preventDefault } as unknown as React.KeyboardEvent<HTMLDivElement>;
  return { event, preventDefault };
}

afterEach(() => {
  window.localStorage.clear();
});

describe('useResizableRail', () => {
  it('exposes a keyboard-operable separator with bounded dimensions', () => {
    const { result } = renderHook(() => useResizableRail(baseOptions));

    expect(result.current.resizeHandleProps).toMatchObject({
      role: 'separator',
      tabIndex: 0,
      'aria-label': 'Resize test panel',
      'aria-orientation': 'vertical',
      'aria-valuemin': 200,
      'aria-valuemax': 400,
      'aria-valuenow': 280,
    });

    const grow = keyEvent('ArrowRight');
    act(() => result.current.resizeHandleProps.onKeyDown(grow.event));
    expect(grow.preventDefault).toHaveBeenCalledOnce();
    expect(result.current.width).toBe(300);

    act(() => result.current.resizeHandleProps.onKeyDown(keyEvent('End').event));
    expect(result.current.width).toBe(400);
    expect(window.localStorage.getItem(baseOptions.storageKey)).toBe('400');
  });

  it('reverses horizontal arrow behavior for the history-side rail', () => {
    const { result } = renderHook(() => useResizableRail({ ...baseOptions, side: 'right' }));

    act(() => result.current.resizeHandleProps.onKeyDown(keyEvent('ArrowLeft').event));

    expect(result.current.width).toBe(300);
  });
});
