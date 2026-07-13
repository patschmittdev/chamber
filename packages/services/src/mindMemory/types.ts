/**
 * Minimal port the working-memory reader needs to resolve a mind's folder.
 * Kept separate from `MindProfileMindProvider` because this capability never
 * restarts or mutates a mind: it only reads.
 */
export interface MindMemoryMindProvider {
  getMindPath(mindId: string): string | null;
}
