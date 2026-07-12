import { describe, expect, it } from 'vitest';
import { formatAttachmentSize } from './attachment-format';

describe('formatAttachmentSize', () => {
  it('formats bytes and kibibytes for attachment metadata', () => {
    expect(formatAttachmentSize(11)).toBe('11 B');
    expect(formatAttachmentSize(1536)).toBe('1.5 KB');
  });

  it('labels invalid sizes as unknown', () => {
    expect(formatAttachmentSize(-1)).toBe('unknown size');
    expect(formatAttachmentSize(Number.NaN)).toBe('unknown size');
  });
});
