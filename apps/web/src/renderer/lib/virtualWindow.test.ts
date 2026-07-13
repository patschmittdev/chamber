import { describe, expect, it } from 'vitest';
import {
  computeWindowRange,
  DEFAULT_OVERSCAN_PX,
  DEFAULT_ROW_ESTIMATE_PX,
} from './virtualWindow';

const uniform = (size: number) => () => size;

describe('computeWindowRange', () => {
  it('returns an empty range for an empty list', () => {
    expect(
      computeWindowRange({
        itemCount: 0,
        scrollTop: 0,
        viewportHeight: 500,
        overscanPx: 0,
        getSize: uniform(100),
      }),
    ).toEqual({ startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 });
  });

  it('renders every row with no padding when the whole list fits', () => {
    const range = computeWindowRange({
      itemCount: 3,
      scrollTop: 0,
      viewportHeight: 1000,
      overscanPx: 0,
      getSize: uniform(100),
    });
    expect(range).toEqual({ startIndex: 0, endIndex: 3, paddingTop: 0, paddingBottom: 0 });
  });

  it('windows a top-anchored subset for a long list', () => {
    const range = computeWindowRange({
      itemCount: 100,
      scrollTop: 0,
      viewportHeight: 500,
      overscanPx: 0,
      getSize: uniform(100),
    });
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(5);
    expect(range.paddingTop).toBe(0);
    expect(range.paddingBottom).toBe(9500);
  });

  it('expands the window by the overscan margin', () => {
    const range = computeWindowRange({
      itemCount: 100,
      scrollTop: 0,
      viewportHeight: 500,
      overscanPx: 200,
      getSize: uniform(100),
    });
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(7);
    expect(range.paddingBottom).toBe(9300);
  });

  it('windows a bottom-anchored subset when scrolled to the end', () => {
    const range = computeWindowRange({
      itemCount: 100,
      scrollTop: 9500,
      viewportHeight: 500,
      overscanPx: 0,
      getSize: uniform(100),
    });
    expect(range.startIndex).toBe(95);
    expect(range.endIndex).toBe(100);
    expect(range.paddingTop).toBe(9500);
    expect(range.paddingBottom).toBe(0);
  });

  it('honors variable row sizes when locating the window', () => {
    const sizes = [100, 300, 100, 500, 100];
    const range = computeWindowRange({
      itemCount: sizes.length,
      scrollTop: 350,
      viewportHeight: 200,
      overscanPx: 0,
      getSize: (index) => sizes[index],
    });
    expect(range.startIndex).toBe(1);
    expect(range.endIndex).toBe(4);
    expect(range.paddingTop).toBe(100);
    expect(range.paddingBottom).toBe(100);
  });

  it('anchors to the last row when scrolled past the content', () => {
    const range = computeWindowRange({
      itemCount: 5,
      scrollTop: 100000,
      viewportHeight: 500,
      overscanPx: 0,
      getSize: uniform(100),
    });
    expect(range.startIndex).toBe(4);
    expect(range.endIndex).toBe(5);
    expect(range.paddingTop).toBe(400);
    expect(range.paddingBottom).toBe(0);
  });

  it('always keeps at least one row mounted at a zero-height boundary', () => {
    const range = computeWindowRange({
      itemCount: 5,
      scrollTop: 200,
      viewportHeight: 0,
      overscanPx: 0,
      getSize: uniform(100),
    });
    expect(range.endIndex).toBe(range.startIndex + 1);
    expect(range.startIndex).toBe(2);
  });

  it('exposes sensible defaults for row estimate and overscan', () => {
    expect(DEFAULT_ROW_ESTIMATE_PX).toBeGreaterThan(0);
    expect(DEFAULT_OVERSCAN_PX).toBeGreaterThan(0);
  });
});
