import { lensViewVisibilityKey } from '@chamber/shared';
import type { LensViewManifest } from '@chamber/shared/types';

export function isLensViewEnabled(
  disabledLensViewKeys: readonly string[],
  mindId: string | null,
  viewId: string,
): boolean {
  if (!mindId) return true;
  return !disabledLensViewKeys.includes(lensViewVisibilityKey(mindId, viewId));
}

export function getVisibleLensViews(
  views: readonly LensViewManifest[],
  disabledLensViewKeys: readonly string[],
  mindId: string | null,
): LensViewManifest[] {
  if (!mindId) return [...views];
  const disabled = new Set(disabledLensViewKeys);
  return views.filter((view) => !disabled.has(lensViewVisibilityKey(mindId, view.id)));
}
