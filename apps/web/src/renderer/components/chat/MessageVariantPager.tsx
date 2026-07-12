import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MessageVariantPagerProps {
  /** Zero-based index of the currently shown branch. */
  index: number;
  /** Total number of branches (frozen versions plus the live branch). */
  count: number;
  /** Selects a branch by zero-based index. Bounds are enforced here. */
  onSelect: (index: number) => void;
}

/**
 * Compact prev/next pager for retained edit/regenerate versions, styled to sit
 * quietly beside a message like the hover action row. Shows the human-facing
 * `current/total` (one-based). Prev is disabled on the first branch, next on the
 * last, so the control never selects out of range.
 */
export function MessageVariantPager({ index, count, onSelect }: MessageVariantPagerProps) {
  if (count <= 1) return null;

  const atStart = index <= 0;
  const atEnd = index >= count - 1;

  return (
    <div className="mt-1.5 flex items-center gap-0.5 text-[11px] text-muted-foreground" role="group" aria-label="Message versions">
      <button
        type="button"
        onClick={() => onSelect(index - 1)}
        disabled={atStart}
        aria-label="Previous version"
        className="flex items-center rounded p-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronLeft size={13} aria-hidden />
      </button>
      <span className="tabular-nums" aria-live="polite">
        {index + 1}/{count}
      </span>
      <button
        type="button"
        onClick={() => onSelect(index + 1)}
        disabled={atEnd}
        aria-label="Next version"
        className="flex items-center rounded p-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronRight size={13} aria-hidden />
      </button>
    </div>
  );
}
