/**
 * Pure geometry for a windowed (virtualized) list.
 *
 * Given a scroll position and a way to size each row, it returns the slice of
 * rows that intersect the viewport (plus an overscan margin) together with the
 * spacer heights that keep the scrollbar and offsets correct. It holds no DOM
 * or React state so it can be unit tested in isolation and reused by any list
 * (transcript, conversation history) that needs windowing.
 */

/** Fallback row height, matched to the transcript `contain-intrinsic-size`. */
export const DEFAULT_ROW_ESTIMATE_PX = 140;

/** Extra pixels rendered above and below the viewport to hide scroll seams. */
export const DEFAULT_OVERSCAN_PX = 600;

export interface WindowRangeInput {
  /** Total number of items in the backing list. */
  readonly itemCount: number;
  /** Current scroll offset of the container. */
  readonly scrollTop: number;
  /** Visible height of the scroll container. */
  readonly viewportHeight: number;
  /** Overscan margin applied above and below the viewport. */
  readonly overscanPx: number;
  /** Returns the pixel height of the row at `index`. */
  readonly getSize: (index: number) => number;
}

export interface WindowRange {
  /** First mounted row (inclusive). */
  readonly startIndex: number;
  /** One past the last mounted row (exclusive). */
  readonly endIndex: number;
  /** Spacer height standing in for the rows above `startIndex`. */
  readonly paddingTop: number;
  /** Spacer height standing in for the rows below `endIndex`. */
  readonly paddingBottom: number;
}

const EMPTY_RANGE: WindowRange = { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };

export function computeWindowRange({
  itemCount,
  scrollTop,
  viewportHeight,
  overscanPx,
  getSize,
}: WindowRangeInput): WindowRange {
  if (itemCount <= 0) return EMPTY_RANGE;

  const windowTop = scrollTop - overscanPx;
  const windowBottom = scrollTop + viewportHeight + overscanPx;

  let startIndex = -1;
  let endIndex = itemCount;
  let paddingTop = 0;
  let offset = 0;

  for (let index = 0; index < itemCount; index += 1) {
    const rowTop = offset;
    const rowBottom = offset + getSize(index);

    if (startIndex === -1 && rowBottom > windowTop) {
      startIndex = index;
      paddingTop = rowTop;
    }
    if (startIndex !== -1 && endIndex === itemCount && rowTop >= windowBottom) {
      endIndex = index;
    }
    offset = rowBottom;
  }

  const totalSize = offset;

  // Scrolled entirely past the content: keep the final row mounted as a floor.
  if (startIndex === -1) {
    startIndex = itemCount - 1;
    paddingTop = totalSize - getSize(startIndex);
    endIndex = itemCount;
  }

  // Never collapse to an empty window while items exist.
  if (endIndex <= startIndex) {
    endIndex = Math.min(itemCount, startIndex + 1);
  }

  let windowSize = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    windowSize += getSize(index);
  }
  const paddingBottom = Math.max(0, totalSize - paddingTop - windowSize);

  return { startIndex, endIndex, paddingTop, paddingBottom };
}
