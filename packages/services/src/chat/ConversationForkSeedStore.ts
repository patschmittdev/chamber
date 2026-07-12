import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ChatMessage } from '@chamber/shared/types';
import type { ConversationForkSeed } from './conversationForkContext';

const SEED_FILE = 'seed.json';

export interface ConversationForkSeedStoreOptions {
  storageRoot: string;
}

interface StoredConversationForkSeed extends ConversationForkSeed {
  storageVersion: 1;
  mindId: string;
  sessionId: string;
}

export class ConversationForkSeedStore {
  constructor(private readonly options: ConversationForkSeedStoreOptions) {}

  async save(mindId: string, sessionId: string, seed: ConversationForkSeed): Promise<void> {
    const parent = this.sessionDirectory(mindId, sessionId);
    await fs.mkdir(parent, { recursive: true });
    const tempFile = path.join(parent, `.tmp-${randomUUID()}-${process.pid}.json`);
    const stored: StoredConversationForkSeed = {
      ...seed,
      storageVersion: 1,
      mindId,
      sessionId,
    };
    try {
      await fs.writeFile(tempFile, JSON.stringify(stored, null, 2), 'utf8');
      await fs.rename(tempFile, path.join(parent, SEED_FILE));
    } catch (error) {
      await fs.rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async read(mindId: string, sessionId: string): Promise<ConversationForkSeed | null> {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(this.sessionDirectory(mindId, sessionId), SEED_FILE), 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      throw error;
    }
    const parsed = JSON.parse(raw) as unknown;
    return normalizeStoredSeed(parsed, mindId, sessionId);
  }

  async delete(mindId: string, sessionId: string): Promise<void> {
    await fs.rm(this.sessionDirectory(mindId, sessionId), { recursive: true, force: true });
  }

  private sessionDirectory(mindId: string, sessionId: string): string {
    return path.join(this.options.storageRoot, safePathSegment(mindId), safePathSegment(sessionId));
  }
}

function normalizeStoredSeed(value: unknown, mindId: string, sessionId: string): ConversationForkSeed | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.storageVersion !== 1
    || record.version !== 1
    || record.mindId !== mindId
    || record.sessionId !== sessionId
    || typeof record.fork !== 'object'
    || record.fork === null
    || !Array.isArray(record.messages)
    || typeof record.limits !== 'object'
    || record.limits === null
    || typeof record.truncated !== 'boolean'
  ) {
    return null;
  }

  const fork = record.fork as Record<string, unknown>;
  const limits = record.limits as Record<string, unknown>;
  if (
    typeof fork.sourceSessionId !== 'string'
    || typeof fork.sourceEventId !== 'string'
    || typeof fork.sourceMessageId !== 'string'
    || typeof fork.sourceTitle !== 'string'
    || typeof fork.createdAt !== 'string'
    || typeof limits.maxMessages !== 'number'
    || typeof limits.maxTextCharacters !== 'number'
    || typeof limits.maxToolCharacters !== 'number'
  ) {
    return null;
  }

  return {
    version: 1,
    fork: {
      sourceSessionId: fork.sourceSessionId,
      sourceEventId: fork.sourceEventId,
      sourceMessageId: fork.sourceMessageId,
      sourceTitle: fork.sourceTitle,
      createdAt: fork.createdAt,
    },
    messages: record.messages.filter(isChatMessage),
    limits: {
      maxMessages: limits.maxMessages,
      maxTextCharacters: limits.maxTextCharacters,
      maxToolCharacters: limits.maxToolCharacters,
    },
    truncated: record.truncated,
  };
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string'
    && (record.role === 'user' || record.role === 'assistant')
    && Array.isArray(record.blocks)
    && typeof record.timestamp === 'number'
  );
}

function safePathSegment(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
