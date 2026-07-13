import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeWindowRange,
  DEFAULT_OVERSCAN_PX,
  DEFAULT_ROW_ESTIMATE_PX,
  type WindowRange,
} from '../lib/virtualWindow';

export interface UseWindowedListOptions {
  /** Total number of items in the backing list. */
  readonly itemCount: number;
  /** Resolves the scroll container the window is measured against. */
  readonly getScrollElement: () => HTMLElement | null;
  /**
   * Resolves the element wrapping the windowed rows, when it does not start at
   * the top of the scroll container (for example a list that sits below a
   * pinned section). The scroll offset is then measured from this element so the
   * window tracks the list rather than the whole container. Omit when the rows
   * begin at the top of the scroll container.
   */
  readonly getContentElement?: () => HTMLElement | null;
  /** Stable key for the item at `index`, used to look up its measured height. */
  readonly getKey: (index: number) => string;
  /** Fallback row height before a row has been measured. */
  readonly estimateSize?: number;
  /** Overscan margin rendered above and below the viewport. */
  readonly overscanPx?: number;
  /**
   * When false the hook is inert: it reports the full range with no padding and
   * a no-op measurer, so short lists render exactly as they did unwindowed.
   */
  readonly enabled?: boolean;
}

export interface UseWindowedListResult extends WindowRange {
  /** Ref callback to attach to each rendered row (reads `data-window-key`). */
  readonly measureElement: (element: HTMLElement | null) => void;
}

interface ScrollMetrics {
  readonly scrollTop: number;
  readonly viewportHeight: number;
}

const FULL_RANGE_NOOP: UseWindowedListResult = {
  startIndex: 0,
  endIndex: 0,
  paddingTop: 0,
  paddingBottom: 0,
  measureElement: () => {},
};

/**
 * Windows a long list so only the rows intersecting the viewport (plus an
 * overscan margin) stay mounted, bounding DOM node count and heap for large
 * transcripts. It layers on top of, and does not replace, per-row memoization
 * or `content-visibility` hints on the rows themselves.
 *
 * Heights are keyed by a stable row key so measurements survive insertions and
 * reorders. A single ResizeObserver (when available) keeps growing rows (for
 * example a streaming turn) measured; environments without ResizeObserver fall
 * back to the estimate, which the caller matches to its `contain-intrinsic-size`.
 */
export function useWindowedList({
  itemCount,
  getScrollElement,
  getContentElement,
  getKey,
  estimateSize = DEFAULT_ROW_ESTIMATE_PX,
  overscanPx = DEFAULT_OVERSCAN_PX,
  enabled = true,
}: UseWindowedListOptions): UseWindowedListResult {
  const [metrics, setMetrics] = useState<ScrollMetrics>({ scrollTop: 0, viewportHeight: 0 });
  const [measureVersion, setMeasureVersion] = useState(0);
  const heightsRef = useRef<Map<string, number>>(new Map());
  const rowObserverRef = useRef<ResizeObserver | null>(null);
  const observedRef = useRef<Set<HTMLElement>>(new Set());

  const bumpMeasureVersion = useCallback(() => {
    setMeasureVersion((version) => version + 1);
  }, []);

  const recordHeight = useCallback((element: HTMLElement) => {
    const key = element.dataset.windowKey;
    if (!key) return;
    const next = element.offsetHeight;
    if (next <= 0) return;
    if (heightsRef.current.get(key) === next) return;
    heightsRef.current.set(key, next);
    bumpMeasureVersion();
  }, [bumpMeasureVersion]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        recordHeight(entry.target as HTMLElement);
      }
    });
    rowObserverRef.current = observer;
    // Rows can mount before this observer exists (effects run after paint), so
    // pick up anything already registered by `measureElement`.
    for (const element of observedRef.current) {
      observer.observe(element);
    }
    return () => {
      observer.disconnect();
      rowObserverRef.current = null;
    };
  }, [enabled, recordHeight]);

  const measureElement = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    observedRef.current.add(element);
    recordHeight(element);
    rowObserverRef.current?.observe(element);
    return () => {
      observedRef.current.delete(element);
      rowObserverRef.current?.unobserve(element);
    };
  }, [recordHeight]);

  useEffect(() => {
    if (!enabled) return;
    const element = getScrollElement();
    if (!element) return;

    let frame = 0;
    const readMetrics = () => {
      frame = 0;
      const content = getContentElement?.();
      let scrollTop = element.scrollTop;
      if (content) {
        // The rows do not begin at the top of the scroll container, so measure
        // how far the list itself has scrolled above the container's top edge.
        const scrollRect = element.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        scrollTop = Math.max(0, scrollRect.top - contentRect.top);
      }
      setMetrics({ scrollTop, viewportHeight: element.clientHeight });
    };
    const schedule = () => {
      if (frame !== 0) return;
      if (typeof requestAnimationFrame === 'undefined') {
        readMetrics();
        return;
      }
      frame = requestAnimationFrame(readMetrics);
    };

    readMetrics();
    element.addEventListener('scroll', schedule, { passive: true });

    let viewportObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      viewportObserver = new ResizeObserver(schedule);
      viewportObserver.observe(element);
    }

    return () => {
      if (frame !== 0 && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame);
      element.removeEventListener('scroll', schedule);
      viewportObserver?.disconnect();
    };
  }, [enabled, getScrollElement, getContentElement, itemCount]);

  const getSize = useCallback(
    (index: number) => heightsRef.current.get(getKey(index)) ?? estimateSize,
    [getKey, estimateSize],
  );

  const range = useMemo<WindowRange>(() => {
    if (!enabled) {
      return { startIndex: 0, endIndex: itemCount, paddingTop: 0, paddingBottom: 0 };
    }
    return computeWindowRange({
      itemCount,
      scrollTop: metrics.scrollTop,
      viewportHeight: metrics.viewportHeight,
      overscanPx,
      getSize,
    });
    // measureVersion participates so re-measures recompute padding.
  }, [enabled, itemCount, metrics.scrollTop, metrics.viewportHeight, overscanPx, getSize, measureVersion]);

  if (!enabled) {
    return { ...FULL_RANGE_NOOP, endIndex: itemCount };
  }

  return { ...range, measureElement };
}
