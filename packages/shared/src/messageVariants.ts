import type { ChatMessage, MessageVariantGroup } from './types';

export interface MessageVariantPager {
  groupId: string;
  /** Zero-based index of the selected branch. The active branch is the last index. */
  index: number;
  /** Total branches for the group (frozen variants plus the live branch when present). */
  count: number;
}

export interface MessageVariantView {
  messages: ChatMessage[];
  pagerByMessageId: Map<string, MessageVariantPager>;
}

/** Zero-based selected branch index keyed by groupId. Missing groups default to the active branch. */
export type VariantSelectionByGroup = Record<string, number>;

export interface VariantCapture {
  anchorEventId: string | null;
  tail: ChatMessage[];
}

/**
 * Computes the retained-variant capture for a turn that is about to be
 * discarded by an edit or regenerate: the tail from the re-sent user turn
 * (`userEventId`) to the end of the list, plus the anchor (the event id
 * immediately before it; null at the conversation root). Returns null when the
 * turn is absent (already truncated) or the tail is empty. Shared so the service
 * (durable capture) and the renderer (optimistic capture) agree on the anchor
 * and tail without duplicating the rule.
 */
export function deriveVariantTail(
  messages: readonly ChatMessage[],
  userEventId: string,
): VariantCapture | null {
  const userIndex = messages.findIndex((message) => message.eventId === userEventId);
  if (userIndex < 0) return null;
  const tail = messages.slice(userIndex);
  if (tail.length === 0) return null;
  const anchorEventId = userIndex > 0 ? messages[userIndex - 1].eventId ?? null : null;
  return { anchorEventId, tail: [...tail] };
}

interface ResolvedGroup {
  group: MessageVariantGroup;
  tailStart: number;
}

/** The frozen branch a pending send must promote to the live branch first. */
export interface PendingPromotion {
  anchorEventId: string | null;
  variantId: string;
}

/**
 * Resolves the variant that continuing the conversation should promote. Walks
 * the active path outermost-first (mirroring `buildMessageVariantView`): while a
 * group has its active branch selected it descends into nested groups; the first
 * group whose selection points at a frozen branch is the one currently shown as
 * the tail, so that branch is promoted. Returns null when the active branch is
 * selected everywhere (nothing to promote). Shared so the renderer decides to
 * promote-before-send using the same rule the display derivation follows.
 */
export function resolvePendingPromotion(
  liveMessages: readonly ChatMessage[],
  groups: readonly MessageVariantGroup[],
  selectionByGroup: VariantSelectionByGroup = {},
): PendingPromotion | null {
  const resolved = resolveGroups(liveMessages, groups).sort((a, b) => a.tailStart - b.tailStart);
  const seenTailStarts = new Set<number>();
  for (const entry of resolved) {
    if (seenTailStarts.has(entry.tailStart)) continue;
    seenTailStarts.add(entry.tailStart);
    const activeExists = entry.tailStart < liveMessages.length;
    const count = entry.group.frozenVariants.length + (activeExists ? 1 : 0);
    if (count === 0) continue;
    const activeIndex = activeExists ? count - 1 : -1;
    const selected = clampIndex(selectionByGroup[entry.group.groupId] ?? count - 1, count);
    if (activeExists && selected === activeIndex) continue;
    const variant = entry.group.frozenVariants[selected];
    if (!variant) continue;
    return { anchorEventId: entry.group.anchorEventId, variantId: variant.variantId };
  }
  return null;
}

/**
 * Derives the display transcript and per-message pager metadata from the live
 * message list plus the retained variant groups. Pure and side-effect free so
 * it can run identically in the renderer and in tests.
 *
 * Rules:
 * - A group's tail begins immediately after its anchor (root anchors begin at 0).
 *   A group whose anchor is absent from the live list is dormant and renders
 *   nothing (it lives inside a frozen branch that is not currently shown).
 * - Selecting the active branch keeps the live tail and lets inner (nested)
 *   groups keep applying. Selecting a frozen branch emits that snapshot and stops
 *   walking, so turns below it are hidden (single active path).
 * - The pager attaches to the assistant message when every branch shares an
 *   identical leading user prompt (regenerate); otherwise it attaches to the
 *   leading user message (edit). It renders only when a group has more than one
 *   branch.
 */
export function buildMessageVariantView(
  liveMessages: readonly ChatMessage[],
  groups: readonly MessageVariantGroup[],
  selectionByGroup: VariantSelectionByGroup = {},
): MessageVariantView {
  const resolved = resolveGroups(liveMessages, groups);
  const groupByTailStart = new Map<number, ResolvedGroup>();
  for (const entry of resolved) {
    if (!groupByTailStart.has(entry.tailStart)) groupByTailStart.set(entry.tailStart, entry);
  }

  const messages: ChatMessage[] = [];
  const pagerByMessageId = new Map<string, MessageVariantPager>();

  let index = 0;
  while (index <= liveMessages.length) {
    const entry = groupByTailStart.get(index);
    if (entry) {
      const outcome = applyGroup(entry, liveMessages, index, selectionByGroup, messages, pagerByMessageId);
      if (outcome === 'stop') break;
      if (outcome === 'consumed') {
        index += 1;
        continue;
      }
    }
    if (index >= liveMessages.length) break;
    messages.push(liveMessages[index]);
    index += 1;
  }

  return { messages, pagerByMessageId };
}

function resolveGroups(
  liveMessages: readonly ChatMessage[],
  groups: readonly MessageVariantGroup[],
): ResolvedGroup[] {
  const resolved: ResolvedGroup[] = [];
  for (const group of groups) {
    if (group.frozenVariants.length === 0) continue;
    if (group.anchorEventId === null) {
      resolved.push({ group, tailStart: 0 });
      continue;
    }
    const anchorIndex = liveMessages.findIndex((message) => message.eventId === group.anchorEventId);
    if (anchorIndex < 0) continue;
    resolved.push({ group, tailStart: anchorIndex + 1 });
  }
  return resolved;
}

type GroupOutcome = 'consumed' | 'stop' | 'skip';

function applyGroup(
  entry: ResolvedGroup,
  liveMessages: readonly ChatMessage[],
  tailStart: number,
  selectionByGroup: VariantSelectionByGroup,
  messages: ChatMessage[],
  pagerByMessageId: Map<string, MessageVariantPager>,
): GroupOutcome {
  const { group } = entry;
  const activeTail = liveMessages.slice(tailStart);
  const activeExists = activeTail.length > 0;
  const branches = branchLeads(group, activeTail, activeExists);
  const count = branches.length;
  if (count === 0) return 'skip';

  const activeIndex = activeExists ? count - 1 : -1;
  const defaultIndex = activeExists ? activeIndex : count - 1;
  const selected = clampIndex(selectionByGroup[group.groupId] ?? defaultIndex, count);
  const placement = derivePlacement(branches);

  if (activeExists && selected === activeIndex) {
    if (count > 1) {
      const target = placement === 'assistant' ? liveMessages[tailStart + 1] : liveMessages[tailStart];
      if (target) pagerByMessageId.set(target.id, { groupId: group.groupId, index: selected, count });
    }
    return 'skip';
  }

  const snapshot = group.frozenVariants[selected]?.messages ?? [];
  for (const message of snapshot) messages.push(message);
  if (count > 1) {
    const target = placement === 'assistant' ? snapshot[1] : snapshot[0];
    if (target) pagerByMessageId.set(target.id, { groupId: group.groupId, index: selected, count });
  }
  return 'stop';
}

function branchLeads(
  group: MessageVariantGroup,
  activeTail: readonly ChatMessage[],
  activeExists: boolean,
): ChatMessage[][] {
  const branches = group.frozenVariants.map((variant) => variant.messages);
  if (activeExists) branches.push([...activeTail]);
  return branches;
}

function derivePlacement(branches: readonly ChatMessage[][]): 'user' | 'assistant' {
  const leads = branches.map((branch) => branch[0]);
  const everyLeadsWithUser = leads.every((message) => message?.role === 'user');
  if (!everyLeadsWithUser) return 'user';
  const firstText = plainTextOf(leads[0]);
  const samePrompt = leads.every((message) => plainTextOf(message) === firstText);
  const everyHasAssistant = branches.every((branch) => branch.some((message, position) => position > 0 && message.role === 'assistant'));
  return samePrompt && everyHasAssistant ? 'assistant' : 'user';
}

function plainTextOf(message: ChatMessage | undefined): string {
  if (!message) return '';
  return message.blocks
    .filter((block): block is Extract<ChatMessage['blocks'][number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.content)
    .join('');
}

function clampIndex(value: number, count: number): number {
  if (!Number.isInteger(value)) return count - 1;
  if (value < 0) return 0;
  if (value > count - 1) return count - 1;
  return value;
}
