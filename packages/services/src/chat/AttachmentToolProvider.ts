import type { ChamberToolProvider } from '../chamberTools';
import type { Tool } from '../mind/types';
import {
  DEFAULT_ATTACHMENT_LIST_LIMIT,
  DEFAULT_ATTACHMENT_READ_BYTES,
  MAX_ATTACHMENT_LIST_LIMIT,
  MAX_ATTACHMENT_READ_BYTES,
  type AttachmentListResult,
  type AttachmentReadOptions,
  type AttachmentReadResult,
} from './AttachmentStore';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';

interface AttachmentReadStore {
  list(mindId: string, sessionId: string, limit?: number): Promise<AttachmentListResult>;
  read(mindId: string, sessionId: string, attachmentId: string, options?: AttachmentReadOptions): Promise<AttachmentReadResult>;
}

export class AttachmentToolProvider implements ChamberToolProvider {
  constructor(private readonly attachmentStore: AttachmentReadStore) {}

  getToolsForMind(mindId: string): Tool[] {
    return [
      {
        name: 'attachment_list',
        description: 'List documents attached to this Chamber chat for the current mind. Returns opaque attachment ids and metadata only.',
        parameters: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: `Optional maximum number of attachments to return, capped at ${MAX_ATTACHMENT_LIST_LIMIT}.`,
            },
          },
        },
        handler: async (args: Record<string, unknown>, invocation) => {
          const limit = typeof args.limit === 'number' ? args.limit : DEFAULT_ATTACHMENT_LIST_LIMIT;
          try {
            return await this.attachmentStore.list(mindId, invocation.sessionId, limit);
          } catch (error) {
            return { error: getErrorMessage(error) };
          }
        },
      },
      {
        name: 'attachment_read',
        description: 'Read a bounded UTF-8 prefix of a document attached to this Chamber chat. Only opaque attachment ids from attachment_list are accepted.',
        parameters: {
          type: 'object',
          properties: {
            attachment_id: {
              type: 'string',
              description: 'Opaque attachment id returned by attachment_list or shown in the chat attachment manifest.',
            },
            max_bytes: {
              type: 'number',
              description: `Optional maximum bytes to read, capped at ${MAX_ATTACHMENT_READ_BYTES}. Defaults to ${DEFAULT_ATTACHMENT_READ_BYTES}.`,
            },
          },
          required: ['attachment_id'],
        },
        handler: async (args: Record<string, unknown>, invocation) => {
          if (typeof args.attachment_id !== 'string' || args.attachment_id.trim().length === 0) {
            return { error: 'attachment_id is required' };
          }
          const maxBytes = typeof args.max_bytes === 'number' ? args.max_bytes : undefined;
          try {
            return await this.attachmentStore.read(mindId, invocation.sessionId, args.attachment_id, { maxBytes });
          } catch (error) {
            return { error: getErrorMessage(error) };
          }
        },
      },
    ];
  }
}
