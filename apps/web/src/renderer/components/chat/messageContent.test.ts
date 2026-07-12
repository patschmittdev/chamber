import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '@chamber/shared/types';
import { hasAttachmentBlocks, hasImageBlocks, stripMarkdown, toMarkdown, toPlainText } from './messageContent';

function assistant(content: string): ChatMessage {
  return { id: 'a1', role: 'assistant', blocks: [{ type: 'text', content }], timestamp: 1 };
}

describe('messageContent', () => {
  describe('toMarkdown', () => {
    it('returns the raw markdown source of the text blocks', () => {
      const message = assistant('# Title\n\nSome **bold** text with `code`.');
      expect(toMarkdown(message)).toBe('# Title\n\nSome **bold** text with `code`.');
    });

    it('joins multiple text blocks and ignores non-text blocks', () => {
      const message: ChatMessage = {
        id: 'a1',
        role: 'assistant',
        timestamp: 1,
        blocks: [
          { type: 'text', content: 'First. ' },
          { type: 'tool_call', toolCallId: 't1', toolName: 'grep', status: 'done' },
          { type: 'text', content: 'Second.' },
        ],
      };
      expect(toMarkdown(message)).toBe('First. Second.');
    });

    it('includes document attachment placeholders without payload content', () => {
      const message: ChatMessage = {
        id: 'u1',
        role: 'user',
        timestamp: 1,
        blocks: [
          {
            type: 'attachment',
            id: 'att-1',
            kind: 'document',
            displayName: 'notes.txt',
            mimeType: 'text/plain',
            size: 11,
          },
          { type: 'text', content: 'Summarize this.' },
        ],
      };

      expect(toMarkdown(message)).toBe('[attachment: notes.txt (text/plain, 11 B)]\n\nSummarize this.');
      expect(toMarkdown(message)).not.toContain('hello world');
    });
  });

  describe('toPlainText', () => {
    it('strips markdown formatting to readable text', () => {
      const message = assistant('# Heading\n\nSome **bold** and *italic* and `code` here.');
      expect(toPlainText(message)).toBe('Heading\n\nSome bold and italic and code here.');
    });

    it('is distinct from the raw markdown copy', () => {
      const message = assistant('See [the docs](https://example.com) for **details**.');
      expect(toMarkdown(message)).toBe('See [the docs](https://example.com) for **details**.');
      expect(toPlainText(message)).toBe('See the docs for details.');
    });
  });

  describe('stripMarkdown', () => {
    it('removes list markers while keeping item text', () => {
      expect(stripMarkdown('- one\n- two\n1. three')).toBe('one\ntwo\nthree');
    });

    it('unwraps fenced code blocks and inline code', () => {
      expect(stripMarkdown('```ts\nconst x = 1;\n```')).toBe('const x = 1;');
      expect(stripMarkdown('use `npm test` now')).toBe('use npm test now');
    });

    it('drops blockquote markers and horizontal rules', () => {
      expect(stripMarkdown('> quoted line\n\n---\n\ntail')).toBe('quoted line\n\ntail');
    });

    it('reduces images to their alt text', () => {
      expect(stripMarkdown('![diagram](data:image/png;base64,zzz)')).toBe('diagram');
    });
  });

  describe('hasImageBlocks', () => {
    it('is false for a text-only message', () => {
      expect(hasImageBlocks(assistant('just text'))).toBe(false);
    });

    it('is true when an image block is present alongside text', () => {
      const message: ChatMessage = {
        id: 'u1',
        role: 'user',
        timestamp: 1,
        blocks: [
          { type: 'image', name: 'shot.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,aaa' },
          { type: 'text', content: 'what is this?' },
        ],
      };
      expect(hasImageBlocks(message)).toBe(true);
    });

    it('is true for an image-only message', () => {
      const message: ChatMessage = {
        id: 'u1',
        role: 'user',
        timestamp: 1,
        blocks: [{ type: 'image', name: 'only.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,bbb' }],
      };
      expect(hasImageBlocks(message)).toBe(true);
    });

    describe('hasAttachmentBlocks', () => {
      it('is false for a text-only message', () => {
        expect(hasAttachmentBlocks(assistant('just text'))).toBe(false);
      });

      it('is true when a document attachment block is present', () => {
        const message: ChatMessage = {
          id: 'u1',
          role: 'user',
          timestamp: 1,
          blocks: [
            {
              type: 'attachment',
              id: 'att-1',
              kind: 'document',
              displayName: 'notes.txt',
              mimeType: 'text/plain',
              size: 11,
            },
            { type: 'text', content: 'what is this?' },
          ],
        };

        expect(hasAttachmentBlocks(message)).toBe(true);
      });
    });
  });
});
