import type { ChatMessage, ContentBlock } from '@chamber/shared/types';

/**
 * Copy helpers for a chat message. Two distinct clipboard payloads:
 * `toMarkdown` returns the raw markdown source (verbatim text blocks), while
 * `toPlainText` returns the same content with markdown formatting stripped for
 * pasting into plain-text surfaces.
 */

function textBlocks(message: ChatMessage): string[] {
  return message.blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.content);
}

/**
 * True when a message carries image content. Edit and regenerate resend only
 * the text prompt, so turns with images cannot be safely replayed yet; callers
 * use this to disable those actions rather than silently drop the attachments.
 */
export function hasImageBlocks(message: ChatMessage): boolean {
  return message.blocks.some((block) => block.type === 'image');
}

/** Raw markdown source of a message: its text blocks joined verbatim. */
export function toMarkdown(message: ChatMessage): string {
  return textBlocks(message).join('').trim();
}

/** Human-readable plain text: the message's markdown with formatting removed. */
export function toPlainText(message: ChatMessage): string {
  return stripMarkdown(toMarkdown(message));
}

/**
 * Best-effort markdown-to-plaintext conversion covering the common constructs
 * Chamber renders (headings, emphasis, code, links, images, lists, quotes,
 * rules). Not a full parser; intended for clipboard readability, not fidelity.
 */
export function stripMarkdown(markdown: string): string {
  const withoutFences = markdown.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_match, code: string) => code);
  const lines = withoutFences.split('\n').map((line) => stripBlockPrefixes(line));
  return stripInline(lines.join('\n')).replace(/\n{3,}/g, '\n\n').trim();
}

function stripBlockPrefixes(line: string): string {
  if (/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(line)) return '';
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^(\s*)(?:[-*+]|\d+\.)\s+/, '$1');
}

function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1');
}
