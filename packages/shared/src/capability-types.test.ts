import { describe, expectTypeOf, it } from 'vitest';
import type {
  CapabilityInventoryItem,
  CapabilityInventoryQuery,
  CapabilityInventoryResult,
  CapabilityScope,
} from './capability-types';

describe('capability inventory contracts', () => {
  it('represents global and per-mind capability scopes', () => {
    expectTypeOf<CapabilityScope>().toMatchTypeOf<
      | { readonly kind: 'global' }
      | { readonly kind: 'mind'; readonly mindId: string }
    >();
  });

  it('keeps lifecycle inventory queries and results renderer-safe', () => {
    expectTypeOf<CapabilityInventoryQuery['availability']>().toEqualTypeOf<
      'installed' | 'available' | 'all' | undefined
    >();
    expectTypeOf<CapabilityInventoryResult['items']>().toEqualTypeOf<readonly CapabilityInventoryItem[]>();
  });
});
