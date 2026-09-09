import { describe, expect, it } from 'vitest';
import { isLongPastedText, pastedTextPreview, PASTED_TEXT_ATTACHMENT_THRESHOLD } from './pasted-text.js';

describe('pasted text rules', () => {
  it('requires the paste event content to reach the character threshold', () => {
    expect(isLongPastedText('a'.repeat(PASTED_TEXT_ATTACHMENT_THRESHOLD - 1))).toBe(false);
    expect(isLongPastedText('a'.repeat(PASTED_TEXT_ATTACHMENT_THRESHOLD))).toBe(true);
  });

  it('creates a bounded first-line preview', () => {
    expect(pastedTextPreview('  First line with details\nsecond line')).toBe('First line with details');
    expect(pastedTextPreview('a'.repeat(80))).toBe(`${'a'.repeat(71)}…`);
  });
});
