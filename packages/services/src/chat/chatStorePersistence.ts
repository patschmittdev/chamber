import { Buffer } from 'node:buffer';
import type { ChatMessage } from '@chamber/shared/types';

/**
 * Encodes an arbitrary identifier (mindId, sessionId) into a single filesystem
 * path segment. base64url keeps the value reversible and free of separators or
 * traversal sequences, so a hostile id cannot escape the storage root.
 */
export function safePathSegment(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/** Structural guard for a persisted ChatMessage read back from an untrusted JSON store. */
export function isStoredChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string'
    && (record.role === 'user' || record.role === 'assistant')
    && Array.isArray(record.blocks)
    && typeof record.timestamp === 'number'
  );
}
