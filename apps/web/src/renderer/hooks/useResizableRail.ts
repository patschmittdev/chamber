import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

const KEYBOARD_STEP = 20;

export type ResizableRailSide = 'left' | 'right';

interface UseResizableRailOptions {
  defaultWidth: number;
  label: string;
  maxWidth: number;
  minWidth: number;
  side: ResizableRailSide;
  storageKey: string;
}

interface ResizeSession {
  cleanup: () => void;
}

function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.max(minWidth, Math.min(maxWidth, width));
}

function readWidth(storageKey: string, defaultWidth: number, minWidth: number, maxWidth: number): number {
  if (typeof window === 'undefined') return defaultWidth;

  try {
    const savedWidth = Number.parseInt(window.localStorage.getItem(storageKey) ?? '', 10);
    return Number.isFinite(savedWidth) ? clampWidth(savedWidth, minWidth, maxWidth) : defaultWidth;
  } catch {
    return defaultWidth;
  }
}

/**
 * Shares bounded width persistence and accessible pointer and keyboard resizing
 * between shell side rails without coupling their content or collapse behavior.
 */
export function useResizableRail({
  defaultWidth,
  label,
  maxWidth,
  minWidth,
  side,
  storageKey,
}: UseResizableRailOptions) {
  const [width, setWidth] = useState(() => readWidth(storageKey, defaultWidth, minWidth, maxWidth));
  const [isResizing, setIsResizing] = useState(false);
  const sessionRef = useRef<ResizeSession | null>(null);

  const finishResize = useCallback(() => {
    sessionRef.current?.cleanup();
    sessionRef.current = null;
    setIsResizing(false);
  }, []);

  useEffect(() => () => finishResize(), [finishResize]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(width));
    } catch {
      // Width changes remain usable when storage is unavailable.
    }
  }, [storageKey, width]);

  const updateWidth = useCallback((nextWidth: number) => {
    setWidth(clampWidth(nextWidth, minWidth, maxWidth));
  }, [maxWidth, minWidth]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();
    finishResize();

    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = width;
    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;

      const distance = side === 'left'
        ? moveEvent.clientX - startX
        : startX - moveEvent.clientX;
      updateWidth(startWidth + distance);
    };
    const onPointerEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId === pointerId) finishResize();
    };
    const onLostPointerCapture = () => finishResize();
    const cleanup = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerEnd);
      document.removeEventListener('pointercancel', onPointerEnd);
      target.removeEventListener('lostpointercapture', onLostPointerCapture);
    };

    sessionRef.current = { cleanup };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerEnd);
    document.addEventListener('pointercancel', onPointerEnd);
    target.addEventListener('lostpointercapture', onLostPointerCapture);
    target.setPointerCapture?.(pointerId);
    setIsResizing(true);
  }, [finishResize, side, updateWidth, width]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const growsTowardLeft = side === 'right';
    const grows = event.key === (growsTowardLeft ? 'ArrowLeft' : 'ArrowRight');
    const shrinks = event.key === (growsTowardLeft ? 'ArrowRight' : 'ArrowLeft');

    if (event.key === 'Home') {
      event.preventDefault();
      updateWidth(minWidth);
    } else if (event.key === 'End') {
      event.preventDefault();
      updateWidth(maxWidth);
    } else if (grows || shrinks) {
      event.preventDefault();
      setWidth((currentWidth) => clampWidth(
        currentWidth + (grows ? KEYBOARD_STEP : -KEYBOARD_STEP),
        minWidth,
        maxWidth,
      ));
    }
  }, [maxWidth, minWidth, side, updateWidth]);

  return {
    isResizing,
    resizeHandleProps: {
      'aria-label': label,
      'aria-orientation': 'vertical' as const,
      'aria-valuemax': maxWidth,
      'aria-valuemin': minWidth,
      'aria-valuenow': width,
      onKeyDown,
      onPointerDown,
      role: 'separator' as const,
      tabIndex: 0,
    },
    width,
  };
}
