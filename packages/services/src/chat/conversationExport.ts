// Pure serialization of a conversation into shareable Markdown or JSON.
// No Electron or filesystem access — the desktop IPC layer owns the save dialog
// and file write; this module only turns a conversation + its messages into text.

import type {
  ChatMessage,
  ContentBlock,
  ConversationExport,
  ConversationExportFormat,
  ConversationSummary,
} from '@chamber/shared/types';

export interface ConversationExportOptions {
  /** ISO timestamp recorded in the export. Injectable for deterministic tests. */
  exportedAt?: string;
}

/** Build the serialized payload plus a suggested file name for a save dialog. */
export function buildConversationExport(
  conversation: ConversationSummary,
  messages: ChatMessage[],
  format: ConversationExportFormat,
  options: ConversationExportOptions = {},
): ConversationExport {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const content = format === 'json'
    ? serializeConversationToJson(conversation, messages, { exportedAt })
    : serializeConversationToMarkdown(conversation, messages, { exportedAt });
  return {
    format,
    filename: conversationExportFilename(conversation, format),
    content,
  };
}

/** `Planning thread` + `markdown` -> `planning-thread.md`. */
export function conversationExportFilename(
  conversation: ConversationSummary,
  format: ConversationExportFormat,
): string {
  const extension = format === 'json' ? 'json' : 'md';
  const slug = slugifyConversationTitle(conversation.title) || conversation.sessionId || 'conversation';
  return `${slug}.${extension}`;
}

export function slugifyConversationTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function serializeConversationToJson(
  conversation: ConversationSummary,
  messages: ChatMessage[],
  options: ConversationExportOptions = {},
): string {
  const payload = {
    sessionId: conversation.sessionId,
    title: conversation.title,
    kind: conversation.kind,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    messages,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function serializeConversationToMarkdown(
  conversation: ConversationSummary,
  messages: ChatMessage[],
  options: ConversationExportOptions = {},
): string {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const lines: string[] = [
    `# ${conversation.title || 'Conversation'}`,
    '',
    `- Session: ${conversation.sessionId}`,
    `- Created: ${conversation.createdAt}`,
    `- Updated: ${conversation.updatedAt}`,
    `- Exported: ${exportedAt}`,
    `- Messages: ${messages.length}`,
    '',
  ];

  if (messages.length === 0) {
    lines.push('_No messages in this conversation._', '');
    return `${lines.join('\n')}`;
  }

  for (const message of messages) {
    lines.push(`## ${roleHeading(message.role)}`, '');
    const rendered = message.blocks.map(renderBlockToMarkdown).filter((block) => block.length > 0);
    lines.push(rendered.length > 0 ? rendered.join('\n\n') : '_(empty message)_', '');
  }

  return `${lines.join('\n')}`;
}

function roleHeading(role: ChatMessage['role']): string {
  return role === 'assistant' ? 'Assistant' : 'User';
}

function renderBlockToMarkdown(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.content.trim();
    case 'reasoning':
      return blockquote(`Reasoning\n\n${block.content.trim()}`);
    case 'tool_call':
      return renderToolCall(block);
    case 'image':
      return `_[image: ${block.name} (${block.mimeType})]_`;
    case 'permission':
      return `_[permission: ${block.kind} - ${block.summary} (${block.outcome})]_`;
    default:
      return '';
  }
}

function renderToolCall(block: Extract<ContentBlock, { type: 'tool_call' }>): string {
  const parts: string[] = [`**Tool call:** \`${block.toolName}\` (${block.status})`];
  if (block.arguments && Object.keys(block.arguments).length > 0) {
    parts.push(fencedCode(JSON.stringify(block.arguments, null, 2), 'json'));
  }
  if (block.output) {
    parts.push(fencedCode(block.output));
  }
  if (block.error) {
    parts.push(`Error: ${block.error}`);
  }
  return parts.join('\n\n');
}

function blockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n');
}

function fencedCode(text: string, language = ''): string {
  return `\`\`\`${language}\n${text}\n\`\`\``;
}
