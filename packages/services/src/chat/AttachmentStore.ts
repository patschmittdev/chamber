import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ChatAttachmentManifest,
  ChatAttachmentMetadata,
  ChatDocumentAttachment,
} from '@chamber/shared/types';

export const DEFAULT_ATTACHMENT_MAX_BYTES = 256 * 1024;
export const DEFAULT_ATTACHMENT_READ_BYTES = 32 * 1024;
export const MAX_ATTACHMENT_READ_BYTES = 256 * 1024;
export const DEFAULT_ATTACHMENT_LIST_LIMIT = 50;
export const MAX_ATTACHMENT_LIST_LIMIT = 100;

const METADATA_FILE = 'metadata.json';
const PAYLOAD_FILE = 'payload.txt';
const OPAQUE_ID_RE = /^[A-Za-z0-9_-]{1,160}$/;
const DISALLOWED_METADATA_KEYS = new Set(['path', 'absolutePath', 'originalPath', 'sourcePath']);

export interface AttachmentStoreClock {
  now(): Date;
}

export interface AttachmentStoreIdGenerator {
  nextId(): string;
}

export interface AttachmentStoreOptions {
  storageRoot: string;
  clock?: AttachmentStoreClock;
  idGenerator?: AttachmentStoreIdGenerator;
  maxAttachmentBytes?: number;
}

export interface AttachmentListResult {
  attachments: ChatAttachmentManifest[];
  total: number;
  limit: number;
  truncated: boolean;
}

export interface AttachmentReadOptions {
  maxBytes?: number;
}

export interface AttachmentReadResult {
  attachment: ChatAttachmentManifest;
  content: string;
  bytesRead: number;
  totalBytes: number;
  truncated: boolean;
}

interface StoredAttachmentMetadata extends ChatAttachmentManifest {
  version: 1;
  mindId: string;
  sessionId: string;
  payloadFile: typeof PAYLOAD_FILE;
}

export class AttachmentStore {
  private readonly clock: AttachmentStoreClock;
  private readonly idGenerator: AttachmentStoreIdGenerator;
  private readonly maxAttachmentBytes: number;

  constructor(private readonly options: AttachmentStoreOptions) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.idGenerator = options.idGenerator ?? { nextId: () => randomUUID() };
    this.maxAttachmentBytes = options.maxAttachmentBytes ?? DEFAULT_ATTACHMENT_MAX_BYTES;
  }

  async saveDocument(mindId: string, sessionId: string, attachment: ChatDocumentAttachment): Promise<ChatAttachmentManifest> {
    const id = this.nextOpaqueId();
    const displayName = safeDisplayName(attachment.displayName);
    const mimeType = attachment.mimeType.trim() || 'text/plain';
    const payload = Buffer.from(attachment.content, 'utf8');
    const declaredSize = Number.isFinite(attachment.size) ? attachment.size : payload.byteLength;

    if (declaredSize > this.maxAttachmentBytes || payload.byteLength > this.maxAttachmentBytes) {
      throw new Error(`Attachment ${displayName} exceeds the ${this.maxAttachmentBytes} byte limit`);
    }

    const metadata: StoredAttachmentMetadata = {
      version: 1,
      id,
      mindId,
      sessionId,
      kind: 'document',
      displayName,
      mimeType,
      size: payload.byteLength,
      createdAt: this.clock.now().toISOString(),
      payloadFile: PAYLOAD_FILE,
      metadata: sanitizeMetadata(attachment.metadata),
    };

    const parent = this.sessionDirectory(mindId, sessionId);
    await fs.mkdir(parent, { recursive: true });
    const tempDir = path.join(parent, `.tmp-${id}-${process.pid}`);
    const finalDir = path.join(parent, id);

    await fs.mkdir(tempDir, { recursive: false });
    try {
      await fs.writeFile(path.join(tempDir, PAYLOAD_FILE), payload);
      await fs.writeFile(path.join(tempDir, METADATA_FILE), JSON.stringify(metadata, null, 2), 'utf8');
      await fs.rename(tempDir, finalDir);
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    return toManifest(metadata);
  }

  async list(mindId: string, sessionId: string, limit = DEFAULT_ATTACHMENT_LIST_LIMIT): Promise<AttachmentListResult> {
    const boundedLimit = boundedPositiveInteger(limit, DEFAULT_ATTACHMENT_LIST_LIMIT, MAX_ATTACHMENT_LIST_LIMIT);
    const dir = this.sessionDirectory(mindId, sessionId);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { attachments: [], total: 0, limit: boundedLimit, truncated: false };
      }
      throw error;
    }

    const attachments = await Promise.all(
      entries
        .filter((entry) => OPAQUE_ID_RE.test(entry))
        .map((entry) => this.readStoredMetadata(mindId, sessionId, entry)),
    );
    const sorted = attachments
      .map(toManifest)
      .sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
    const limited = sorted.slice(0, boundedLimit);
    return {
      attachments: limited,
      total: sorted.length,
      limit: boundedLimit,
      truncated: sorted.length > limited.length,
    };
  }

  async read(mindId: string, sessionId: string, attachmentId: string, options: AttachmentReadOptions = {}): Promise<AttachmentReadResult> {
    const metadata = await this.readStoredMetadata(mindId, sessionId, attachmentId);
    const payloadPath = path.join(this.attachmentDirectory(mindId, sessionId, attachmentId), metadata.payloadFile);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(payloadPath);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new Error(`Attachment payload is missing for ${attachmentId}`, { cause: error });
      }
      throw error;
    }

    const maxBytes = boundedPositiveInteger(options.maxBytes, DEFAULT_ATTACHMENT_READ_BYTES, MAX_ATTACHMENT_READ_BYTES);
    const bytesToRead = Math.min(stat.size, maxBytes);
    const handle = await fs.open(payloadPath, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
      return {
        attachment: toManifest(metadata),
        content: buffer.subarray(0, bytesRead).toString('utf8'),
        bytesRead,
        totalBytes: stat.size,
        truncated: stat.size > bytesRead,
      };
    } finally {
      await handle.close();
    }
  }

  private async readStoredMetadata(mindId: string, sessionId: string, attachmentId: string): Promise<StoredAttachmentMetadata> {
    assertOpaqueId(attachmentId);
    const metadataPath = path.join(this.attachmentDirectory(mindId, sessionId, attachmentId), METADATA_FILE);
    let raw: string;
    try {
      raw = await fs.readFile(metadataPath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        throw new Error(`Attachment metadata is missing for ${attachmentId}`, { cause: error });
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Attachment metadata is malformed for ${attachmentId}`, { cause: error });
    }
    return parseStoredMetadata(parsed, attachmentId, mindId, sessionId);
  }

  private nextOpaqueId(): string {
    const candidate = `att_${this.idGenerator.nextId().replace(/[^A-Za-z0-9_-]/g, '')}`;
    assertOpaqueId(candidate);
    return candidate;
  }

  private attachmentDirectory(mindId: string, sessionId: string, attachmentId: string): string {
    assertOpaqueId(attachmentId);
    return path.join(this.sessionDirectory(mindId, sessionId), attachmentId);
  }

  private sessionDirectory(mindId: string, sessionId: string): string {
    return path.join(this.options.storageRoot, 'minds', encodeScopeId(mindId), 'sessions', encodeScopeId(sessionId));
  }
}

function parseStoredMetadata(value: unknown, attachmentId: string, mindId: string, sessionId: string): StoredAttachmentMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Attachment metadata is malformed for ${attachmentId}`);
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    record.id !== attachmentId ||
    record.mindId !== mindId ||
    record.sessionId !== sessionId ||
    record.kind !== 'document' ||
    record.payloadFile !== PAYLOAD_FILE ||
    typeof record.displayName !== 'string' ||
    typeof record.mimeType !== 'string' ||
    typeof record.size !== 'number' ||
    typeof record.createdAt !== 'string' ||
    !isMetadata(record.metadata)
  ) {
    throw new Error(`Attachment metadata is malformed for ${attachmentId}`);
  }

  return {
    version: 1,
    id: attachmentId,
    mindId,
    sessionId,
    kind: 'document',
    displayName: record.displayName,
    mimeType: record.mimeType,
    size: record.size,
    createdAt: record.createdAt,
    payloadFile: PAYLOAD_FILE,
    metadata: record.metadata,
  };
}

function toManifest(metadata: StoredAttachmentMetadata): ChatAttachmentManifest {
  return {
    id: metadata.id,
    kind: metadata.kind,
    displayName: metadata.displayName,
    mimeType: metadata.mimeType,
    size: metadata.size,
    createdAt: metadata.createdAt,
    ...(metadata.metadata ? { metadata: metadata.metadata } : {}),
  };
}

function assertOpaqueId(id: string): void {
  if (!OPAQUE_ID_RE.test(id)) {
    throw new Error('Attachment id is invalid');
  }
}

function boundedPositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function encodeScopeId(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function safeDisplayName(displayName: string): string {
  const normalized = displayName.replace(/\\/g, '/');
  const leaf = normalized.split('/').filter(Boolean).at(-1)?.trim() ?? '';
  const withoutControlCharacters = Array.from(leaf, (char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || code === 127 ? ' ' : char;
  }).join('');
  return withoutControlCharacters.replace(/\s+/g, ' ').slice(0, 200) || 'attachment.txt';
}

function sanitizeMetadata(metadata: ChatAttachmentMetadata | undefined): ChatAttachmentMetadata | undefined {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata)
    .filter(([key, value]) => !DISALLOWED_METADATA_KEYS.has(key) && isMetadataValue(value));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isMetadata(value: unknown): value is ChatAttachmentMetadata | undefined {
  if (value === undefined) return true;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(isMetadataValue);
}

function isMetadataValue(value: unknown): value is ChatAttachmentMetadata[string] {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
