import { describe, it, expect } from 'vitest';
import type { ChatMessage, ConversationSummary } from '@chamber/shared/types';
import {
  buildConversationExport,
  conversationExportFilename,
  serializeConversationToJson,
  serializeConversationToMarkdown,
  slugifyConversationTitle,
} from './conversationExport';

const conversation: ConversationSummary = {
  sessionId: 'session-42',
  title: 'Planning: the Q3 roadmap!',
  createdAt: '2026-05-05T22:00:00.000Z',
  updatedAt: '2026-05-05T22:30:00.000Z',
  kind: 'chat',
  active: true,
  hasMessages: true,
};

const messages: ChatMessage[] = [
  {
    id: 'u1',
    role: 'user',
    timestamp: Date.parse('2026-05-05T22:00:00.000Z'),
    blocks: [{ type: 'text', content: 'How should we plan Q3?' }],
  },
  {
    id: 'a1',
    role: 'assistant',
    timestamp: Date.parse('2026-05-05T22:00:05.000Z'),
    blocks: [
      { type: 'reasoning', reasoningId: 'r1', content: 'Consider capacity first.' },
      { type: 'text', content: 'Start by ranking initiatives.' },
      {
        type: 'tool_call',
        toolCallId: 't1',
        toolName: 'list_issues',
        status: 'done',
        arguments: { label: 'roadmap' },
        output: 'Found 3 issues',
      },
    ],
  },
];

const options = { exportedAt: '2026-06-01T00:00:00.000Z' };

describe('slugifyConversationTitle', () => {
  it('lowercases, strips punctuation, and collapses separators', () => {
    expect(slugifyConversationTitle('Planning: the Q3 roadmap!')).toBe('planning-the-q3-roadmap');
  });

  it('returns an empty string when nothing survives normalization', () => {
    expect(slugifyConversationTitle('!!!')).toBe('');
  });
});

describe('conversationExportFilename', () => {
  it('uses the slugified title with a format extension', () => {
    expect(conversationExportFilename(conversation, 'markdown')).toBe('planning-the-q3-roadmap.md');
    expect(conversationExportFilename(conversation, 'json')).toBe('planning-the-q3-roadmap.json');
  });

  it('falls back to the session id when the title has no usable slug', () => {
    const untitled: ConversationSummary = { ...conversation, title: '   ' };
    expect(conversationExportFilename(untitled, 'markdown')).toBe('session-42.md');
  });
});

describe('serializeConversationToMarkdown', () => {
  it('renders a readable header and one section per turn', () => {
    const md = serializeConversationToMarkdown(conversation, messages, options);

    expect(md).toContain('# Planning: the Q3 roadmap!');
    expect(md).toContain('- Session: session-42');
    expect(md).toContain('- Exported: 2026-06-01T00:00:00.000Z');
    expect(md).toContain('- Messages: 2');
    expect(md).toContain('## User');
    expect(md).toContain('How should we plan Q3?');
    expect(md).toContain('## Assistant');
    expect(md).toContain('Start by ranking initiatives.');
  });

  it('renders fork source metadata and keeps fork seed messages before new turns', () => {
    const forked: ConversationSummary = {
      ...conversation,
      title: 'Fork of Source chat',
      forkOf: {
        sourceSessionId: 'source-session',
        sourceEventId: 'evt-2',
        sourceMessageId: 'a1',
        sourceTitle: 'Source chat',
        createdAt: '2026-05-05T22:10:00.000Z',
      },
    };
    const ordered: ChatMessage[] = [
      {
        id: 'fork-seed:source-session:u1',
        role: 'user',
        timestamp: 1,
        forkSeed: true,
        blocks: [{ type: 'text', content: 'seed question' }],
      },
      {
        id: 'fork-seed:source-session:a1',
        role: 'assistant',
        timestamp: 2,
        forkSeed: true,
        blocks: [{ type: 'tool_call', toolCallId: 't1', toolName: 'search', status: 'done', output: 'seed result' }],
      },
      {
        id: 'u2',
        role: 'user',
        timestamp: 3,
        blocks: [{ type: 'text', content: 'new fork question' }],
      },
    ];

    const md = serializeConversationToMarkdown(forked, ordered, options);

    expect(md).toContain('- Fork of: Source chat');
    expect(md.indexOf('seed question')).toBeLessThan(md.indexOf('seed result'));
    expect(md.indexOf('seed result')).toBeLessThan(md.indexOf('new fork question'));
  });

  it('renders reasoning as a blockquote and tool calls with fenced arguments and output', () => {
    const md = serializeConversationToMarkdown(conversation, messages, options);

    expect(md).toContain('> Reasoning');
    expect(md).toContain('> Consider capacity first.');
    expect(md).toContain('**Tool call:** `list_issues` (done)');
    expect(md).toContain('```json');
    expect(md).toContain('"label": "roadmap"');
    expect(md).toContain('Found 3 issues');
  });

  it('renders image and permission blocks as compact placeholders without em dashes', () => {
    const withMedia: ChatMessage[] = [
      {
        id: 'a2',
        role: 'assistant',
        timestamp: 0,
        blocks: [
          { type: 'image', name: 'chart.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AAAA' },
          { type: 'permission', requestId: 'p1', kind: 'shell', summary: 'run ls', outcome: 'approved' },
        ],
      },
    ];

    const md = serializeConversationToMarkdown(conversation, withMedia, options);

    expect(md).toContain('_[image: chart.png (image/png)]_');
    expect(md).toContain('_[permission: shell - run ls (approved)]_');
    expect(md).not.toContain('base64,AAAA');
    expect(md).not.toContain('\u2014');
  });

  it('renders document attachments as compact references without payloads or paths', () => {
    const withAttachment: ChatMessage[] = [
      {
        id: 'u2',
        role: 'user',
        timestamp: 0,
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
      },
    ];

    const md = serializeConversationToMarkdown(conversation, withAttachment, options);

    expect(md).toContain('_[attachment: notes.txt (text/plain, 11 B, id att-1)]_');
    expect(md).toContain('Summarize this.');
    expect(md).not.toContain('hello world');
    expect(md).not.toContain('C:\\');
  });

  it('escapes tool output that itself contains a code fence so the block cannot close early', () => {
    const withFence: ChatMessage[] = [
      {
        id: 'a3',
        role: 'assistant',
        timestamp: 0,
        blocks: [
          {
            type: 'tool_call',
            toolCallId: 't9',
            toolName: 'cat',
            status: 'done',
            output: 'here is code:\n```js\nconst x = 1;\n```\ndone',
          },
        ],
      },
    ];

    const md = serializeConversationToMarkdown(conversation, withFence, options);

    // The outer fence must be longer than the inner ``` so it does not close early.
    expect(md).toContain('````');
    expect(md).toContain('```js');
    expect(md).toContain('const x = 1;');
  });

  it('notes when a conversation has no messages', () => {
    const md = serializeConversationToMarkdown(conversation, [], options);
    expect(md).toContain('_No messages in this conversation._');
  });
});

describe('serializeConversationToJson', () => {
  it('produces valid JSON that preserves metadata and full message blocks', () => {
    const json = serializeConversationToJson(conversation, messages, options);
    expect(json.endsWith('\n')).toBe(true);

    const parsed = JSON.parse(json);
    expect(parsed.sessionId).toBe('session-42');
    expect(parsed.title).toBe('Planning: the Q3 roadmap!');
    expect(parsed.exportedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[1].blocks[2].toolName).toBe('list_issues');
  });

  it('includes fork metadata in JSON exports', () => {
    const json = serializeConversationToJson({
      ...conversation,
      forkOf: {
        sourceSessionId: 'source-session',
        sourceEventId: 'evt-2',
        sourceMessageId: 'a1',
        sourceTitle: 'Source chat',
        createdAt: '2026-05-05T22:10:00.000Z',
      },
    }, messages, options);

    expect(JSON.parse(json).forkOf).toEqual({
      sourceSessionId: 'source-session',
      sourceEventId: 'evt-2',
      sourceMessageId: 'a1',
      sourceTitle: 'Source chat',
      createdAt: '2026-05-05T22:10:00.000Z',
    });
  });
});

describe('buildConversationExport', () => {
  it('selects the markdown serializer and filename', () => {
    const result = buildConversationExport(conversation, messages, 'markdown', options);
    expect(result.format).toBe('markdown');
    expect(result.filename).toBe('planning-the-q3-roadmap.md');
    expect(result.content).toContain('# Planning: the Q3 roadmap!');
  });

  it('selects the json serializer and filename', () => {
    const result = buildConversationExport(conversation, messages, 'json', options);
    expect(result.format).toBe('json');
    expect(result.filename).toBe('planning-the-q3-roadmap.json');
    expect(() => JSON.parse(result.content)).not.toThrow();
  });
});
