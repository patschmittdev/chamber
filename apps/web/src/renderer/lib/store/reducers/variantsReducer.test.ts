/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { appReducer, initialState } from '..';
import type { AppState } from '..';
import type { MessageVariantGroup } from '@chamber/shared/types';
import { makeMessage, makeTextBlock } from '../../../../test/helpers';

function userTurn(id: string, eventId: string, text: string) {
  return makeMessage([makeTextBlock(text)], { id, role: 'user', eventId });
}

function assistantTurn(id: string, eventId: string, text: string) {
  return makeMessage([makeTextBlock(text)], { id, role: 'assistant', eventId });
}

function baseState(overrides?: Partial<AppState>): AppState {
  return { ...initialState, activeMindId: 'm1', ...overrides };
}

describe('variantsReducer', () => {
  describe('CAPTURE_MESSAGE_VARIANT', () => {
    it('freezes the tail of a regenerate anchored at the conversation root', () => {
      const messages = [userTurn('u1', 'evt-1', 'Question'), assistantTurn('a1', 'evt-2', 'Answer one')];
      const state = baseState({ messagesByMind: { m1: messages } });

      const next = appReducer(state, { type: 'CAPTURE_MESSAGE_VARIANT', payload: { mindId: 'm1', userEventId: 'evt-1' } });

      const groups = next.variantGroupsByMind.m1;
      expect(groups).toHaveLength(1);
      expect(groups[0].anchorEventId).toBeNull();
      expect(groups[0].frozenVariants[0].messages.map((message) => message.eventId)).toEqual(['evt-1', 'evt-2']);
    });

    it('anchors an edit variant at the parent turn before the edited message', () => {
      const messages = [
        userTurn('u1', 'evt-1', 'First'),
        assistantTurn('a1', 'evt-2', 'Reply one'),
        userTurn('u2', 'evt-3', 'Second'),
        assistantTurn('a2', 'evt-4', 'Reply two'),
      ];
      const state = baseState({ messagesByMind: { m1: messages } });

      const next = appReducer(state, { type: 'CAPTURE_MESSAGE_VARIANT', payload: { mindId: 'm1', userEventId: 'evt-3' } });

      expect(next.variantGroupsByMind.m1[0].anchorEventId).toBe('evt-2');
      expect(next.variantGroupsByMind.m1[0].frozenVariants[0].messages.map((message) => message.eventId)).toEqual(['evt-3', 'evt-4']);
    });

    it('retains the frozen tail after a subsequent TRUNCATE_AFTER removes it from the live list', () => {
      const messages = [userTurn('u1', 'evt-1', 'Question'), assistantTurn('a1', 'evt-2', 'Answer one')];
      const captured = appReducer(
        baseState({ messagesByMind: { m1: messages } }),
        { type: 'CAPTURE_MESSAGE_VARIANT', payload: { mindId: 'm1', userEventId: 'evt-1' } },
      );

      const truncated = appReducer(captured, { type: 'TRUNCATE_AFTER', payload: { mindId: 'm1', messageId: 'u1' } });

      expect(truncated.messagesByMind.m1).toEqual([]);
      expect(truncated.variantGroupsByMind.m1[0].frozenVariants[0].messages.map((message) => message.eventId)).toEqual(['evt-1', 'evt-2']);
    });

    it('does not double-capture the same tail', () => {
      const messages = [userTurn('u1', 'evt-1', 'Question'), assistantTurn('a1', 'evt-2', 'Answer one')];
      const once = appReducer(
        baseState({ messagesByMind: { m1: messages } }),
        { type: 'CAPTURE_MESSAGE_VARIANT', payload: { mindId: 'm1', userEventId: 'evt-1' } },
      );

      const twice = appReducer(once, { type: 'CAPTURE_MESSAGE_VARIANT', payload: { mindId: 'm1', userEventId: 'evt-1' } });

      expect(twice.variantGroupsByMind.m1[0].frozenVariants).toHaveLength(1);
    });

    it('is a no-op when the target user turn is not present', () => {
      const messages = [userTurn('u1', 'evt-1', 'Question')];
      const state = baseState({ messagesByMind: { m1: messages } });

      const next = appReducer(state, { type: 'CAPTURE_MESSAGE_VARIANT', payload: { mindId: 'm1', userEventId: 'evt-99' } });

      expect(next).toBe(state);
    });
  });

  describe('SET_MESSAGE_VARIANTS', () => {
    it('replaces optimistic groups with the authoritative set', () => {
      const optimistic: MessageVariantGroup = {
        groupId: 'optimistic:root',
        anchorEventId: null,
        frozenVariants: [{ variantId: 'optimistic:u1', createdAt: 't', messages: [userTurn('u1', 'evt-1', 'q')] }],
      };
      const authoritative: MessageVariantGroup = {
        groupId: 'uuid-1',
        anchorEventId: null,
        frozenVariants: [{ variantId: 'v1', createdAt: 't', messages: [userTurn('u1', 'evt-1', 'q')] }],
      };
      const state = baseState({ variantGroupsByMind: { m1: [optimistic] } });

      const next = appReducer(state, { type: 'SET_MESSAGE_VARIANTS', payload: { mindId: 'm1', groups: [authoritative] } });

      expect(next.variantGroupsByMind.m1).toEqual([authoritative]);
    });

    it('prunes selection entries for groups that no longer exist', () => {
      const state = baseState({
        variantGroupsByMind: { m1: [] },
        variantSelectionByMind: { m1: { 'stale-group': 0, 'kept-group': 1 } },
      });
      const kept: MessageVariantGroup = { groupId: 'kept-group', anchorEventId: null, frozenVariants: [] };

      const next = appReducer(state, { type: 'SET_MESSAGE_VARIANTS', payload: { mindId: 'm1', groups: [kept] } });

      expect(next.variantSelectionByMind.m1).toEqual({ 'kept-group': 1 });
    });
  });

  describe('SELECT_MESSAGE_VARIANT', () => {
    it('records the selected branch index for a group', () => {
      const state = baseState();

      const next = appReducer(state, { type: 'SELECT_MESSAGE_VARIANT', payload: { mindId: 'm1', groupId: 'g1', index: 0 } });

      expect(next.variantSelectionByMind.m1).toEqual({ g1: 0 });
    });

    it('is a no-op when the selection is unchanged', () => {
      const state = baseState({ variantSelectionByMind: { m1: { g1: 0 } } });

      const next = appReducer(state, { type: 'SELECT_MESSAGE_VARIANT', payload: { mindId: 'm1', groupId: 'g1', index: 0 } });

      expect(next).toBe(state);
    });
  });

  describe('lifecycle resets', () => {
    const populated = (): AppState =>
      baseState({
        messagesByMind: { m1: [userTurn('u1', 'evt-1', 'q')] },
        variantGroupsByMind: { m1: [{ groupId: 'g1', anchorEventId: null, frozenVariants: [{ variantId: 'v1', createdAt: 't', messages: [userTurn('u1', 'evt-1', 'q')] }] }] },
        variantSelectionByMind: { m1: { g1: 0 } },
      });

    it('clears variants on NEW_CONVERSATION', () => {
      const next = appReducer(populated(), { type: 'NEW_CONVERSATION', payload: { mindId: 'm1' } });
      expect(next.variantGroupsByMind.m1).toBeUndefined();
      expect(next.variantSelectionByMind.m1).toBeUndefined();
    });

    it('clears variants on CLEAR_MESSAGES', () => {
      const next = appReducer(populated(), { type: 'CLEAR_MESSAGES' });
      expect(next.variantGroupsByMind.m1).toBeUndefined();
      expect(next.variantSelectionByMind.m1).toBeUndefined();
    });

    it('clears variants on RESUME_CONVERSATION', () => {
      const next = appReducer(populated(), {
        type: 'RESUME_CONVERSATION',
        payload: { mindId: 'm1', sessionId: 's1', messages: [], conversations: [] },
      });
      expect(next.variantGroupsByMind.m1).toBeUndefined();
      expect(next.variantSelectionByMind.m1).toBeUndefined();
    });
  });
});
