import { describe, expect, it, vi } from 'vitest';
import {
  createModeratorDecisionCache,
  partitionParticipantOverflow,
} from './chatroomPerformance';

describe('partitionParticipantOverflow', () => {
  it('returns a hidden count and visible list when participant count exceeds limit', () => {
    const result = partitionParticipantOverflow(
      ['a', 'b', 'c', 'd', 'e'],
      3,
    );

    expect(result.visible).toEqual(['a', 'b', 'c']);
    expect(result.hidden).toEqual(['d', 'e']);
    expect(result.hiddenCount).toBe(2);
  });
});

describe('createModeratorDecisionCache', () => {
  it('memoizes parse output for unchanged message text', () => {
    const parse = vi.fn(() => ({ nextSpeaker: 'Jarvis', direction: 'Keep going', action: 'direct' as const }));
    const cache = createModeratorDecisionCache(parse);

    const first = cache.get('msg-1', 'payload');
    const second = cache.get('msg-1', 'payload');

    expect(parse).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('re-parses when the cached message text changes', () => {
    const parse = vi
      .fn()
      .mockReturnValueOnce({ nextSpeaker: 'Jarvis', direction: 'One', action: 'direct' as const })
      .mockReturnValueOnce({ nextSpeaker: 'Jarvis', direction: 'Two', action: 'direct' as const });
    const cache = createModeratorDecisionCache(parse);

    const first = cache.get('msg-1', 'payload-a');
    const second = cache.get('msg-1', 'payload-b');

    expect(parse).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
    expect(second?.direction).toBe('Two');
  });
});
