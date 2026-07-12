import type { AttachmentBlock, ChatAttachmentManifest } from '@chamber/shared/types';

const ATTACHMENT_CONTEXT_START = '<chamber_attachment_manifest>';
const ATTACHMENT_CONTEXT_END = '</chamber_attachment_manifest>';

interface AttachmentPromptManifest {
  version: 1;
  retrieval: string;
  attachments: ChatAttachmentManifest[];
}

export interface ParsedAttachmentContext {
  text: string;
  attachments: ChatAttachmentManifest[];
}

export function appendAttachmentManifestContext(
  prompt: string,
  attachments: readonly ChatAttachmentManifest[],
): string {
  if (attachments.length === 0) return prompt;
  const manifest: AttachmentPromptManifest = {
    version: 1,
    retrieval: 'Use the attachment_list and attachment_read tools with the opaque attachment id to inspect these documents. Do not ask for or infer filesystem paths.',
    attachments: [...attachments],
  };
  const suffix = [
    ATTACHMENT_CONTEXT_START,
    JSON.stringify(manifest, null, 2),
    ATTACHMENT_CONTEXT_END,
  ].join('\n');
  const base = prompt.trimEnd();
  return `${base}${base ? '\n\n' : ''}${suffix}`;
}

export function parseAttachmentManifestContext(content: string): ParsedAttachmentContext {
  const attachments: ChatAttachmentManifest[] = [];
  const text = content.replace(
    /<chamber_attachment_manifest>\s*([\s\S]*?)\s*<\/chamber_attachment_manifest>/g,
    (_match, raw: string) => {
      const parsed = parsePromptManifest(raw);
      if (parsed) attachments.push(...parsed.attachments);
      return '';
    },
  ).trimEnd();
  return { text, attachments };
}

export function attachmentBlockFromManifest(manifest: ChatAttachmentManifest): AttachmentBlock {
  return {
    type: 'attachment',
    id: manifest.id,
    kind: manifest.kind,
    displayName: manifest.displayName,
    mimeType: manifest.mimeType,
    size: manifest.size,
    ...(manifest.createdAt ? { createdAt: manifest.createdAt } : {}),
    ...(manifest.metadata ? { metadata: manifest.metadata } : {}),
  };
}

function parsePromptManifest(raw: string): AttachmentPromptManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.attachments)) return null;
  const attachments = record.attachments.filter(isAttachmentManifest);
  return {
    version: 1,
    retrieval: typeof record.retrieval === 'string' ? record.retrieval : '',
    attachments,
  };
}

function isAttachmentManifest(value: unknown): value is ChatAttachmentManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    (record.kind === 'document' || record.kind === 'image') &&
    typeof record.displayName === 'string' &&
    typeof record.mimeType === 'string' &&
    typeof record.size === 'number'
  );
}
