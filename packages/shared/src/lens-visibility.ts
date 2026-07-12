export function lensViewVisibilityKey(mindId: string, viewId: string): string {
  return `${encodeURIComponent(mindId)}:${encodeURIComponent(viewId)}`;
}

export function parseLensViewVisibilityKey(key: string): { mindId: string; viewId: string } | null {
  const separator = key.indexOf(':');
  if (separator <= 0 || separator === key.length - 1) return null;
  try {
    const mindId = decodeURIComponent(key.slice(0, separator));
    const viewId = decodeURIComponent(key.slice(separator + 1));
    if (mindId.length === 0 || viewId.length === 0) return null;
    if (lensViewVisibilityKey(mindId, viewId) !== key) return null;
    return { mindId, viewId };
  } catch {
    return null;
  }
}

export function isLensViewVisibilityKeyForMind(key: string, mindId: string): boolean {
  return parseLensViewVisibilityKey(key)?.mindId === mindId;
}
