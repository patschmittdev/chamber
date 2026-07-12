import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MessageVariant, MessageVariantGroup } from '@chamber/shared/types';
import { isNodeError, isStoredChatMessage, safePathSegment } from './chatStorePersistence';

const VARIANTS_FILE = 'variants.json';

export interface MessageVariantStoreOptions {
  storageRoot: string;
}

interface StoredMessageVariants {
  storageVersion: 1;
  mindId: string;
  sessionId: string;
  groups: MessageVariantGroup[];
}

/**
 * Persists retained edit/regenerate variant groups per (mindId, sessionId) under
 * the mind directory. Mirrors ConversationForkSeedStore: atomic temp-file writes,
 * base64url path segments, a versioned envelope, and strict normalization so a
 * malformed or foreign file degrades to an empty list rather than throwing.
 */
export class MessageVariantStore {
  constructor(private readonly options: MessageVariantStoreOptions) {}

  async read(mindId: string, sessionId: string): Promise<MessageVariantGroup[]> {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(this.sessionDirectory(mindId, sessionId), VARIANTS_FILE), 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return [];
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    return normalizeStoredVariants(parsed, mindId, sessionId);
  }

  async save(mindId: string, sessionId: string, groups: MessageVariantGroup[]): Promise<void> {
    if (groups.length === 0) {
      await this.delete(mindId, sessionId);
      return;
    }
    const parent = this.sessionDirectory(mindId, sessionId);
    await fs.mkdir(parent, { recursive: true });
    const tempFile = path.join(parent, `.tmp-${randomUUID()}-${process.pid}.json`);
    const stored: StoredMessageVariants = { storageVersion: 1, mindId, sessionId, groups };
    try {
      await fs.writeFile(tempFile, JSON.stringify(stored, null, 2), 'utf8');
      await fs.rename(tempFile, path.join(parent, VARIANTS_FILE));
    } catch (error) {
      await fs.rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async delete(mindId: string, sessionId: string): Promise<void> {
    await fs.rm(this.sessionDirectory(mindId, sessionId), { recursive: true, force: true });
  }

  private sessionDirectory(mindId: string, sessionId: string): string {
    return path.join(this.options.storageRoot, safePathSegment(mindId), safePathSegment(sessionId));
  }
}

function normalizeStoredVariants(value: unknown, mindId: string, sessionId: string): MessageVariantGroup[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  if (
    record.storageVersion !== 1
    || record.mindId !== mindId
    || record.sessionId !== sessionId
    || !Array.isArray(record.groups)
  ) {
    return [];
  }
  const groups: MessageVariantGroup[] = [];
  for (const candidate of record.groups) {
    const group = normalizeGroup(candidate);
    if (group) groups.push(group);
  }
  return groups;
}

function normalizeGroup(value: unknown): MessageVariantGroup | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.groupId !== 'string') return null;
  if (record.anchorEventId !== null && typeof record.anchorEventId !== 'string') return null;
  if (!Array.isArray(record.frozenVariants)) return null;
  const frozenVariants: MessageVariant[] = [];
  for (const candidate of record.frozenVariants) {
    const variant = normalizeVariant(candidate);
    if (variant) frozenVariants.push(variant);
  }
  if (frozenVariants.length === 0) return null;
  return { groupId: record.groupId, anchorEventId: record.anchorEventId, frozenVariants };
}

function normalizeVariant(value: unknown): MessageVariant | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.variantId !== 'string' || typeof record.createdAt !== 'string') return null;
  if (!Array.isArray(record.messages)) return null;
  const messages = record.messages.filter(isStoredChatMessage);
  if (messages.length === 0) return null;
  return { variantId: record.variantId, createdAt: record.createdAt, messages };
}
