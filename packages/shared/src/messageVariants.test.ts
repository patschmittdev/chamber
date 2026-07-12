import { describe, it, expect } from 'vitest';
import type { ChatMessage, MessageVariantGroup } from './types';
import { buildMessageVariantView, resolvePendingPromotion } from './messageVariants';

function user(id: string, text: string, eventId?: string): ChatMessage {
  return {
    id,
    role: 'user',
    blocks: [{ type: 'text', content: text }],
    timestamp: 0,
    ...(eventId ? { eventId } : {}),
  };
}

function assistant(id: string, text: string, eventId?: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ type: 'text', content: text }],
    timestamp: 0,
    ...(eventId ? { eventId } : {}),
  };
}

function group(
  groupId: string,
  anchorEventId: string | null,
  variants: Array<{ variantId: string; messages: ChatMessage[] }>,
): MessageVariantGroup {
  return {
    groupId,
    anchorEventId,
    frozenVariants: variants.map((variant) => ({ ...variant, createdAt: '2024-01-01T00:00:00.000Z' })),
  };
}

describe('buildMessageVariantView', () => {
  it('returns the live messages unchanged and no pager when there are no groups', () => {
    const live = [user('u1', 'hi', 'e1'), assistant('a1', 'hello', 'e2')];
    const view = buildMessageVariantView(live, [], {});
    expect(view.messages).toEqual(live);
    expect(view.pagerByMessageId.size).toBe(0);
  });

  it('places the pager on the assistant message for a regenerate group and defaults to the active branch', () => {
    const live = [user('u2', 'question', 'e1'), assistant('a2', 'new answer', 'e2')];
    const regen = group('g1', null, [
      { variantId: 'v1', messages: [user('u1', 'question'), assistant('a1', 'old answer')] },
    ]);
    const view = buildMessageVariantView(live, [regen], {});
    expect(view.messages).toEqual(live);
    const pager = view.pagerByMessageId.get('a2');
    expect(pager).toEqual({ groupId: 'g1', index: 1, count: 2 });
    expect(view.pagerByMessageId.has('u2')).toBe(false);
  });

  it('shows the frozen snapshot and its pager when a prior regenerate version is selected', () => {
    const live = [user('u2', 'question', 'e1'), assistant('a2', 'new answer', 'e2')];
    const regen = group('g1', null, [
      { variantId: 'v1', messages: [user('u1', 'question'), assistant('a1', 'old answer')] },
    ]);
    const view = buildMessageVariantView(live, [regen], { g1: 0 });
    expect(view.messages.map((message) => message.id)).toEqual(['u1', 'a1']);
    const pager = view.pagerByMessageId.get('a1');
    expect(pager).toEqual({ groupId: 'g1', index: 0, count: 2 });
  });

  it('places the pager on the user message for an edit group', () => {
    const live = [user('u2', 'edited prompt', 'e1'), assistant('a2', 'edited answer', 'e2')];
    const edit = group('g1', null, [
      { variantId: 'v1', messages: [user('u1', 'original prompt'), assistant('a1', 'original answer')] },
    ]);
    const view = buildMessageVariantView(live, [edit], {});
    const pager = view.pagerByMessageId.get('u2');
    expect(pager).toEqual({ groupId: 'g1', index: 1, count: 2 });
    expect(view.pagerByMessageId.has('a2')).toBe(false);
  });

  it('selecting a frozen edit version shows that prompt and answer and hides the live tail', () => {
    const live = [user('u2', 'edited prompt', 'e1'), assistant('a2', 'edited answer', 'e2')];
    const edit = group('g1', null, [
      { variantId: 'v1', messages: [user('u1', 'original prompt'), assistant('a1', 'original answer')] },
    ]);
    const view = buildMessageVariantView(live, [edit], { g1: 0 });
    expect(view.messages.map((message) => message.id)).toEqual(['u1', 'a1']);
    expect(view.pagerByMessageId.get('u1')).toEqual({ groupId: 'g1', index: 0, count: 2 });
  });

  it('anchors a group after a preceding turn and keeps earlier messages visible', () => {
    const live = [
      user('u0', 'first', 'e0'),
      assistant('a0', 'first answer', 'e1'),
      user('u2', 'second', 'e2'),
      assistant('a2', 'second new', 'e3'),
    ];
    const regen = group('g1', 'e1', [
      { variantId: 'v1', messages: [user('u1', 'second'), assistant('a1', 'second old')] },
    ]);
    const active = buildMessageVariantView(live, [regen], {});
    expect(active.messages.map((message) => message.id)).toEqual(['u0', 'a0', 'u2', 'a2']);
    expect(active.pagerByMessageId.get('a2')).toEqual({ groupId: 'g1', index: 1, count: 2 });

    const frozen = buildMessageVariantView(live, [regen], { g1: 0 });
    expect(frozen.messages.map((message) => message.id)).toEqual(['u0', 'a0', 'u1', 'a1']);
    expect(frozen.pagerByMessageId.get('a1')).toEqual({ groupId: 'g1', index: 0, count: 2 });
  });

  it('renders nothing for a dormant group whose anchor is absent from the live list', () => {
    const live = [user('u2', 'q', 'e1'), assistant('a2', 'a', 'e2')];
    const dormant = group('g1', 'missing-anchor', [
      { variantId: 'v1', messages: [user('u1', 'q'), assistant('a1', 'old')] },
    ]);
    const view = buildMessageVariantView(live, [dormant], { g1: 0 });
    expect(view.messages).toEqual(live);
    expect(view.pagerByMessageId.size).toBe(0);
  });

  it('counts three branches after repeated regeneration and reports the active index last', () => {
    const live = [user('u3', 'q', 'e1'), assistant('a3', 'third', 'e2')];
    const regen = group('g1', null, [
      { variantId: 'v1', messages: [user('u1', 'q'), assistant('a1', 'first')] },
      { variantId: 'v2', messages: [user('u2', 'q'), assistant('a2', 'second')] },
    ]);
    const view = buildMessageVariantView(live, [regen], {});
    expect(view.pagerByMessageId.get('a3')).toEqual({ groupId: 'g1', index: 2, count: 3 });
  });

  it('shows the selected frozen branch when the live tail is empty after truncation', () => {
    const live = [user('u0', 'first', 'e0'), assistant('a0', 'first answer', 'e1')];
    const regen = group('g1', 'e1', [
      { variantId: 'v1', messages: [user('u1', 'q'), assistant('a1', 'old')] },
      { variantId: 'v2', messages: [user('u2', 'q'), assistant('a2', 'newer')] },
    ]);
    const view = buildMessageVariantView(live, [regen], { g1: 0 });
    expect(view.messages.map((message) => message.id)).toEqual(['u0', 'a0', 'u1', 'a1']);
    expect(view.pagerByMessageId.get('a1')).toEqual({ groupId: 'g1', index: 0, count: 2 });
  });

  it('applies nested groups along the active path', () => {
    const live = [
      user('u0', 'first', 'e0'),
      assistant('a0', 'first answer', 'e1'),
      user('u2', 'second', 'e2'),
      assistant('a2', 'second new', 'e3'),
    ];
    const outer = group('outer', null, [
      { variantId: 'ov1', messages: [user('ou', 'first old'), assistant('oa', 'first old answer')] },
    ]);
    const inner = group('inner', 'e1', [
      { variantId: 'iv1', messages: [user('iu', 'second'), assistant('ia', 'second old')] },
    ]);
    const view = buildMessageVariantView(live, [outer, inner], {});
    expect(view.messages.map((message) => message.id)).toEqual(['u0', 'a0', 'u2', 'a2']);
    expect(view.pagerByMessageId.get('u0')).toEqual({ groupId: 'outer', index: 1, count: 2 });
    expect(view.pagerByMessageId.get('a2')).toEqual({ groupId: 'inner', index: 1, count: 2 });
  });

  it('clamps an out-of-range selection to the active branch', () => {
    const live = [user('u2', 'q', 'e1'), assistant('a2', 'new', 'e2')];
    const regen = group('g1', null, [
      { variantId: 'v1', messages: [user('u1', 'q'), assistant('a1', 'old')] },
    ]);
    const view = buildMessageVariantView(live, [regen], { g1: 9 });
    expect(view.messages.map((message) => message.id)).toEqual(['u2', 'a2']);
    expect(view.pagerByMessageId.get('a2')).toEqual({ groupId: 'g1', index: 1, count: 2 });
  });
});

describe('resolvePendingPromotion', () => {
  it('returns null when there are no groups', () => {
    const live = [user('u1', 'hi', 'e1'), assistant('a1', 'hello', 'e2')];
    expect(resolvePendingPromotion(live, [], {})).toBeNull();
  });

  it('returns null when the active branch is selected by default', () => {
    const live = [user('u2', 'q', 'e1'), assistant('a2', 'new', 'e2')];
    const regen = group('g1', null, [
      { variantId: 'v1', messages: [user('u1', 'q'), assistant('a1', 'old')] },
    ]);
    expect(resolvePendingPromotion(live, [regen], {})).toBeNull();
  });

  it('returns the frozen variant when a prior version is selected', () => {
    const live = [user('u2', 'q', 'e1'), assistant('a2', 'new', 'e2')];
    const regen = group('g1', null, [
      { variantId: 'v1', messages: [user('u1', 'q'), assistant('a1', 'old')] },
    ]);
    expect(resolvePendingPromotion(live, [regen], { g1: 0 })).toEqual({ anchorEventId: null, variantId: 'v1' });
  });

  it('returns the frozen variant for an anchored group', () => {
    const live = [
      user('u0', 'first', 'e0'),
      assistant('a0', 'first answer', 'e1'),
      user('u2', 'second', 'e2'),
      assistant('a2', 'second new', 'e3'),
    ];
    const regen = group('g1', 'e1', [
      { variantId: 'v1', messages: [user('u1', 'second'), assistant('a1', 'second old')] },
    ]);
    expect(resolvePendingPromotion(live, [regen], { g1: 0 })).toEqual({ anchorEventId: 'e1', variantId: 'v1' });
  });

  it('descends into a nested group when the outer active branch is selected', () => {
    const live = [
      user('u0', 'first', 'e0'),
      assistant('a0', 'first answer', 'e1'),
      user('u2', 'second', 'e2'),
      assistant('a2', 'second new', 'e3'),
    ];
    const outer = group('outer', null, [
      { variantId: 'ov1', messages: [user('ou', 'first old'), assistant('oa', 'first old answer')] },
    ]);
    const inner = group('inner', 'e1', [
      { variantId: 'iv1', messages: [user('iu', 'second'), assistant('ia', 'second old')] },
    ]);
    expect(resolvePendingPromotion(live, [outer, inner], { inner: 0 })).toEqual({ anchorEventId: 'e1', variantId: 'iv1' });
  });

  it('promotes the outer group without descending when its frozen branch is selected', () => {
    const live = [
      user('u0', 'first', 'e0'),
      assistant('a0', 'first answer', 'e1'),
      user('u2', 'second', 'e2'),
      assistant('a2', 'second new', 'e3'),
    ];
    const outer = group('outer', null, [
      { variantId: 'ov1', messages: [user('ou', 'first old'), assistant('oa', 'first old answer')] },
    ]);
    const inner = group('inner', 'e1', [
      { variantId: 'iv1', messages: [user('iu', 'second'), assistant('ia', 'second old')] },
    ]);
    expect(resolvePendingPromotion(live, [outer, inner], { outer: 0, inner: 0 })).toEqual({ anchorEventId: null, variantId: 'ov1' });
  });

  it('promotes a frozen branch even when the live tail is empty after truncation', () => {
    const live = [user('u0', 'first', 'e0'), assistant('a0', 'first answer', 'e1')];
    const regen = group('g1', 'e1', [
      { variantId: 'v1', messages: [user('u1', 'q'), assistant('a1', 'old')] },
    ]);
    expect(resolvePendingPromotion(live, [regen], { g1: 0 })).toEqual({ anchorEventId: 'e1', variantId: 'v1' });
  });

  it('ignores a dormant group whose anchor is absent from the live list', () => {
    const live = [user('u2', 'q', 'e1'), assistant('a2', 'a', 'e2')];
    const dormant = group('g1', 'missing-anchor', [
      { variantId: 'v1', messages: [user('u1', 'q'), assistant('a1', 'old')] },
    ]);
    expect(resolvePendingPromotion(live, [dormant], { g1: 0 })).toBeNull();
  });
});
