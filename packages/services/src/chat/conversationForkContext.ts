import type { ChatAttachmentMetadata, ChatMessage, ContentBlock, ConversationForkRef } from '@chamber/shared/types';

export const CONVERSATION_FORK_CONTEXT_START = '<chamber_conversation_fork_context>';
export const CONVERSATION_FORK_CONTEXT_END = '</chamber_conversation_fork_context>';
export const DEFAULT_FORK_SEED_MAX_MESSAGES = 20;
export const DEFAULT_FORK_SEED_MAX_TEXT_CHARACTERS = 16_000;
export const DEFAULT_FORK_SEED_MAX_TOOL_CHARACTERS = 4_000;

export interface ConversationForkSeed {
  version: 1;
  fork: ConversationForkRef;
  messages: ChatMessage[];
  limits: {
    maxMessages: number;
    maxTextCharacters: number;
    maxToolCharacters: number;
  };
  truncated: boolean;
}

export interface BuildConversationForkSeedOptions {
  maxMessages?: number;
  maxTextCharacters?: number;
  maxToolCharacters?: number;
}

interface BoundedMessagesResult {
  messages: ChatMessage[];
  truncated: boolean;
}

interface BoundedBlockResult {
  block: ContentBlock | null;
  truncated: boolean;
}

interface BoundedTextResult {
  text: string;
  truncated: boolean;
}

export function findConversationForkSourceMessage(
  messages: readonly ChatMessage[],
  sourceEventId: string,
): ChatMessage {
  const sourceMessage = messages.find((message) => message.eventId === sourceEventId);
  if (!sourceMessage) {
    throw new Error(`Conversation event ${sourceEventId} was not found in source conversation`);
  }
  return sourceMessage;
}

export function buildConversationForkSeed(
  messages: readonly ChatMessage[],
  sourceEventId: string,
  fork: ConversationForkRef,
  options: BuildConversationForkSeedOptions = {},
): ConversationForkSeed {
  const sourceIndex = messages.findIndex((message) => message.eventId === sourceEventId);
  if (sourceIndex < 0) {
    throw new Error(`Conversation event ${sourceEventId} was not found in source conversation`);
  }

  const maxMessages = positiveLimit(options.maxMessages, DEFAULT_FORK_SEED_MAX_MESSAGES);
  const maxTextCharacters = positiveLimit(options.maxTextCharacters, DEFAULT_FORK_SEED_MAX_TEXT_CHARACTERS);
  const maxToolCharacters = positiveLimit(options.maxToolCharacters, DEFAULT_FORK_SEED_MAX_TOOL_CHARACTERS);
  const sliced = messages.slice(0, sourceIndex + 1);
  const recent = sliced.slice(Math.max(0, sliced.length - maxMessages));
  const bounded = boundSeedMessages(recent, fork, maxTextCharacters, maxToolCharacters);

  return {
    version: 1,
    fork,
    messages: bounded.messages,
    limits: { maxMessages, maxTextCharacters, maxToolCharacters },
    truncated: sliced.length > recent.length || bounded.truncated || bounded.messages.length < recent.length,
  };
}

export function appendConversationForkContext(prompt: string, seed: ConversationForkSeed): string {
  if (seed.messages.length === 0) return prompt;
  const payload = {
    version: 1,
    source: seed.fork,
    instructions: [
      'The following messages are bounded prior context from a Chamber conversation fork.',
      'Do not re-execute tool calls or permission requests from this context.',
      'Attachment entries are manifests only. Use Chamber attachment tools with opaque ids if access is needed.',
    ],
    messages: seed.messages.map((message) => ({
      role: message.role,
      blocks: message.blocks.map(blockForPrompt),
    })),
    truncated: seed.truncated,
  };
  const suffix = [
    CONVERSATION_FORK_CONTEXT_START,
    stringifyPromptJson(payload),
    CONVERSATION_FORK_CONTEXT_END,
  ].join('\n');
  const base = prompt.trimEnd();
  return `${base}${base ? '\n\n' : ''}${suffix}`;
}

export function stripConversationForkContext(content: string): string {
  return content.replace(
    /<chamber_conversation_fork_context>\s*[\s\S]*?\s*<\/chamber_conversation_fork_context>/g,
    '',
  ).trimEnd();
}

function boundSeedMessages(
  messages: readonly ChatMessage[],
  fork: ConversationForkRef,
  maxTextCharacters: number,
  maxToolCharacters: number,
): BoundedMessagesResult {
  let remainingText = maxTextCharacters;
  let remainingTool = maxToolCharacters;
  let truncated = false;
  const bounded: ChatMessage[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const blocks: ContentBlock[] = [];
    for (let blockIndex = message.blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = message.blocks[blockIndex];
      const boundedBlock = boundBlock(block, {
        remainingText,
        remainingTool,
        onTextConsumed: (count) => { remainingText -= count; },
        onToolConsumed: (count) => { remainingTool -= count; },
      });
      truncated = truncated || boundedBlock.truncated;
      if (boundedBlock.block) blocks.unshift(boundedBlock.block);
    }
    if (blocks.length > 0) {
      bounded.unshift({
        id: `fork-seed:${fork.sourceSessionId}:${message.id}`,
        role: message.role,
        blocks,
        timestamp: message.timestamp,
        sender: message.sender,
        forkSeed: true,
      });
    }
  }

  return { messages: bounded, truncated };
}

function boundBlock(
  block: ContentBlock,
  limits: {
    remainingText: number;
    remainingTool: number;
    onTextConsumed: (count: number) => void;
    onToolConsumed: (count: number) => void;
  },
): BoundedBlockResult {
  switch (block.type) {
    case 'text': {
      const content = takeTail(block.content, limits.remainingText);
      if (!content.text) return { block: null, truncated: content.truncated };
      limits.onTextConsumed(content.text.length);
      return {
        block: { type: 'text', content: content.text, ...(block.sdkMessageId ? { sdkMessageId: block.sdkMessageId } : {}) },
        truncated: content.truncated,
      };
    }
    case 'reasoning': {
      const content = takeTail(block.content, limits.remainingText);
      if (!content.text) return { block: null, truncated: content.truncated };
      limits.onTextConsumed(content.text.length);
      return { block: { ...block, content: content.text }, truncated: content.truncated };
    }
    case 'tool_call': {
      return boundToolBlock(block);
    }
    case 'image':
      return {
        block: {
          type: 'image',
          name: limitString(block.name, 240).text,
          mimeType: limitString(block.mimeType, 120).text,
          dataUrl: '[image data omitted from fork context]',
        },
        truncated: block.dataUrl.length > 0 || limitString(block.name, 240).truncated || limitString(block.mimeType, 120).truncated,
      };
    case 'attachment':
      return boundAttachmentBlock(block);
    case 'permission':
      return boundPermissionBlock(block, limits.remainingText, limits.onTextConsumed);
    default:
      return { block: null, truncated: false };
  }
}

function blockForPrompt(block: ContentBlock): Record<string, unknown> {
  switch (block.type) {
    case 'text':
      return { type: 'text', content: block.content };
    case 'reasoning':
      return { type: 'reasoning', content: block.content };
    case 'tool_call':
      return {
        type: 'tool_call',
        toolName: block.toolName,
        status: block.status,
        arguments: block.arguments,
        output: block.output,
        error: block.error,
      };
    case 'image':
      return { type: 'image', name: block.name, mimeType: block.mimeType, omitted: true };
    case 'attachment':
      return {
        type: 'attachment',
        id: block.id,
        kind: block.kind,
        displayName: block.displayName,
        mimeType: block.mimeType,
        size: block.size,
        metadata: block.metadata,
        createdAt: block.createdAt,
      };
    case 'permission':
      return {
        type: 'permission',
        kind: block.kind,
        summary: block.summary,
        outcome: block.outcome,
      };
    default:
      return { type: 'unknown' };
  }
}

function boundToolBlock(block: Extract<ContentBlock, { type: 'tool_call' }>): BoundedBlockResult {
  const toolCallId = limitString(block.toolCallId, 240);
  const toolName = limitString(block.toolName, 240);
  const parentToolCallId = block.parentToolCallId ? limitString(block.parentToolCallId, 240) : undefined;
  const hasArguments = Boolean(block.arguments && Object.keys(block.arguments).length > 0);
  const hasOutput = typeof block.output === 'string' && block.output.length > 0;
  const hasError = typeof block.error === 'string' && block.error.length > 0;
  return {
    block: {
      type: 'tool_call',
      toolCallId: toolCallId.text,
      toolName: toolName.text,
      status: block.status,
      ...(hasArguments ? { arguments: { omitted: 'Tool arguments omitted from fork context.' } } : {}),
      ...(hasOutput ? { output: '[Tool output omitted from fork context.]' } : {}),
      ...(hasError ? { error: '[Tool error omitted from fork context.]' } : {}),
      ...(parentToolCallId ? { parentToolCallId: parentToolCallId.text } : {}),
    },
    truncated: toolCallId.truncated || toolName.truncated || Boolean(parentToolCallId?.truncated) || hasArguments || hasOutput || hasError,
  };
}

function boundAttachmentBlock(block: Extract<ContentBlock, { type: 'attachment' }>): BoundedBlockResult {
  const displayName = limitString(block.displayName, 240);
  const mimeType = limitString(block.mimeType, 120);
  const metadata = block.metadata ? boundAttachmentMetadata(block.metadata) : undefined;
  return {
    block: {
      type: 'attachment',
      id: limitString(block.id, 240).text,
      kind: block.kind,
      displayName: displayName.text,
      mimeType: mimeType.text,
      size: block.size,
      ...(metadata?.value ? { metadata: metadata.value } : {}),
      ...(block.createdAt ? { createdAt: limitString(block.createdAt, 80).text } : {}),
    },
    truncated: displayName.truncated || mimeType.truncated || Boolean(metadata?.truncated),
  };
}

function boundAttachmentMetadata(
  metadata: NonNullable<Extract<ContentBlock, { type: 'attachment' }>['metadata']>,
): { value: ChatAttachmentMetadata; truncated: boolean } {
  let truncated = false;
  const value: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(metadata)) {
    const safeKey = limitString(key, 80);
    truncated = truncated || safeKey.truncated;
    if (typeof raw === 'string') {
      const safeValue = limitString(raw, 240);
      truncated = truncated || safeValue.truncated;
      value[safeKey.text] = safeValue.text;
    } else {
      value[safeKey.text] = raw;
    }
  }
  return { value, truncated };
}

function boundPermissionBlock(
  block: Extract<ContentBlock, { type: 'permission' }>,
  remainingText: number,
  onTextConsumed: (count: number) => void,
): BoundedBlockResult {
  const summary = takeTail(block.summary, remainingText);
  onTextConsumed(summary.text.length);
  return {
    block: {
      type: 'permission',
      requestId: limitString(block.requestId, 240).text,
      kind: block.kind,
      summary: summary.text || '[Permission summary omitted from fork context.]',
      outcome: block.outcome,
      ...(block.toolCallId ? { toolCallId: limitString(block.toolCallId, 240).text } : {}),
    },
    truncated: summary.truncated || !summary.text,
  };
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function takeTail(content: string, maxCharacters: number): BoundedTextResult {
  if (maxCharacters <= 0) return { text: '', truncated: content.length > 0 };
  if (content.length <= maxCharacters) return { text: content, truncated: false };
  const omitted = '\n[Earlier content omitted from fork context.]';
  if (maxCharacters <= omitted.length) {
    return { text: content.slice(content.length - maxCharacters), truncated: true };
  }
  return {
    text: `${omitted}${content.slice(content.length - maxCharacters + omitted.length)}`,
    truncated: true,
  };
}

function limitString(content: string, maxCharacters: number): BoundedTextResult {
  if (content.length <= maxCharacters) return { text: content, truncated: false };
  return { text: content.slice(0, maxCharacters), truncated: true };
}

function stringifyPromptJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/[<>&]/g, (character) => {
    switch (character) {
      case '<':
        return '\\u003c';
      case '>':
        return '\\u003e';
      case '&':
        return '\\u0026';
      default:
        return character;
    }
  });
}
