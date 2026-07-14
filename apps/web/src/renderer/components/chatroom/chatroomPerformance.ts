export interface ModeratorDecision {
  nextSpeaker: string;
  direction: string;
  action: string;
}

export function parseModeratorJson(text: string): ModeratorDecision | null {
  const match = text.match(/\{[\s\S]*?"next_speaker"[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      nextSpeaker: typeof parsed.next_speaker === 'string' ? parsed.next_speaker : '',
      direction: typeof parsed.direction === 'string' ? parsed.direction : '',
      action: typeof parsed.action === 'string' ? parsed.action : 'direct',
    };
  } catch {
    return null;
  }
}

interface ModeratorDecisionCacheEntry {
  text: string;
  decision: ModeratorDecision | null;
}

export function createModeratorDecisionCache(
  parser: (text: string) => ModeratorDecision | null = parseModeratorJson,
): {
  get: (messageId: string, text: string) => ModeratorDecision | null;
  prune: (validMessageIds: ReadonlySet<string>) => void;
} {
  const cache = new Map<string, ModeratorDecisionCacheEntry>();
  return {
    get(messageId: string, text: string): ModeratorDecision | null {
      const cached = cache.get(messageId);
      if (cached && cached.text === text) {
        return cached.decision;
      }
      const decision = parser(text);
      cache.set(messageId, { text, decision });
      return decision;
    },
    prune(validMessageIds: ReadonlySet<string>): void {
      for (const id of cache.keys()) {
        if (!validMessageIds.has(id)) {
          cache.delete(id);
        }
      }
    },
  };
}

export interface ParticipantOverflow<T> {
  visible: T[];
  hidden: T[];
  hiddenCount: number;
}

export function partitionParticipantOverflow<T>(
  items: readonly T[],
  visibleLimit: number,
): ParticipantOverflow<T> {
  if (visibleLimit <= 0) {
    return { visible: [], hidden: [...items], hiddenCount: items.length };
  }
  if (items.length <= visibleLimit) {
    return { visible: [...items], hidden: [], hiddenCount: 0 };
  }
  return {
    visible: items.slice(0, visibleLimit),
    hidden: items.slice(visibleLimit),
    hiddenCount: items.length - visibleLimit,
  };
}
