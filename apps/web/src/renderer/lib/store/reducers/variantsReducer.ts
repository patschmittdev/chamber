import type { MessageVariant, MessageVariantGroup } from '@chamber/shared/types';
import { deriveVariantTail } from '@chamber/shared/messageVariants';
import type { AppState, AppAction } from '../state';

type Handler<T extends AppAction['type']> = (
  state: AppState,
  action: Extract<AppAction, { type: T }>,
) => Partial<AppState> | AppState;

/**
 * Optimistically freezes the about-to-be-discarded tail before TRUNCATE_AFTER
 * runs, so the version pager appears immediately on edit/regenerate. The
 * authoritative groups replace this via SET_MESSAGE_VARIANTS once the turn
 * settles. Anchor and tail are computed with the shared derivation the service
 * uses, so optimistic and durable groups agree.
 */
function captureMessageVariant(
  state: AppState,
  action: Extract<AppAction, { type: 'CAPTURE_MESSAGE_VARIANT' }>,
): Partial<AppState> | AppState {
  const { mindId, userEventId } = action.payload;
  const messages = state.messagesByMind[mindId];
  if (!messages) return state;
  const capture = deriveVariantTail(messages, userEventId);
  if (!capture) return state;

  const groups = state.variantGroupsByMind[mindId] ?? [];
  const frozen: MessageVariant = {
    variantId: `optimistic:${capture.tail[0].id}`,
    createdAt: new Date().toISOString(),
    messages: capture.tail,
  };
  const existing = groups.find((group) => group.anchorEventId === capture.anchorEventId);
  if (existing?.frozenVariants.some((variant) => variant.messages[0]?.eventId === capture.tail[0].eventId)) {
    return state;
  }

  const nextGroups = existing
    ? groups.map((group) =>
        group === existing ? { ...group, frozenVariants: [...group.frozenVariants, frozen] } : group,
      )
    : [
        ...groups,
        {
          groupId: `optimistic:${capture.anchorEventId ?? 'root'}`,
          anchorEventId: capture.anchorEventId,
          frozenVariants: [frozen],
        } satisfies MessageVariantGroup,
      ];

  return { variantGroupsByMind: { ...state.variantGroupsByMind, [mindId]: nextGroups } };
}

/** Replaces a mind's variant groups with the authoritative set from the service. */
function setMessageVariants(
  state: AppState,
  action: Extract<AppAction, { type: 'SET_MESSAGE_VARIANTS' }>,
): Partial<AppState> | AppState {
  const { mindId, groups } = action.payload;
  const validIds = new Set(groups.map((group) => group.groupId));
  const selection = state.variantSelectionByMind[mindId];
  const prunedSelection = pruneSelection(selection, validIds);
  const selectionChanged = prunedSelection !== selection;

  return {
    variantGroupsByMind: { ...state.variantGroupsByMind, [mindId]: groups },
    ...(selectionChanged
      ? { variantSelectionByMind: { ...state.variantSelectionByMind, [mindId]: prunedSelection } }
      : {}),
  };
}

/** Toggles the displayed branch for a group. Display-only until the next send promotes it. */
function selectMessageVariant(
  state: AppState,
  action: Extract<AppAction, { type: 'SELECT_MESSAGE_VARIANT' }>,
): Partial<AppState> | AppState {
  const { mindId, groupId, index } = action.payload;
  const current = state.variantSelectionByMind[mindId] ?? {};
  if (current[groupId] === index) return state;
  return {
    variantSelectionByMind: {
      ...state.variantSelectionByMind,
      [mindId]: { ...current, [groupId]: index },
    },
  };
}

function pruneSelection(
  selection: Record<string, number> | undefined,
  validIds: Set<string>,
): Record<string, number> {
  if (!selection) return {};
  const entries = Object.entries(selection).filter(([groupId]) => validIds.has(groupId));
  if (entries.length === Object.keys(selection).length) return selection;
  return Object.fromEntries(entries);
}

export const variantsHandlers: {
  CAPTURE_MESSAGE_VARIANT: Handler<'CAPTURE_MESSAGE_VARIANT'>;
  SET_MESSAGE_VARIANTS: Handler<'SET_MESSAGE_VARIANTS'>;
  SELECT_MESSAGE_VARIANT: Handler<'SELECT_MESSAGE_VARIANT'>;
} = {
  CAPTURE_MESSAGE_VARIANT: captureMessageVariant,
  SET_MESSAGE_VARIANTS: setMessageVariants,
  SELECT_MESSAGE_VARIANT: selectMessageVariant,
};
