import { describe, it, expect } from 'vitest';
import { RESERVED_VIEW_IDS, isReservedViewId } from './reservedViewIds';

describe('reservedViewIds', () => {
  it('flags every built-in route id as reserved', () => {
    for (const id of RESERVED_VIEW_IDS) {
      expect(isReservedViewId(id)).toBe(true);
    }
  });

  it('reserves the extensions route id', () => {
    expect(isReservedViewId('extensions')).toBe(true);
  });

  it('keeps the legacy activity id reserved while ViewRouter migrates it to chat', () => {
    expect(isReservedViewId('activity')).toBe(true);
  });

  it('does not reserve arbitrary discovered view ids', () => {
    expect(isReservedViewId('daily-briefing')).toBe(false);
    expect(isReservedViewId('')).toBe(false);
  });
});
