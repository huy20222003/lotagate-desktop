import { describe, expect, it } from 'vitest';
import { normalizeOriginAllowlist } from './origin-allowlist.js';

describe('normalizeOriginAllowlist', () => {
  it('accepts comma- and newline-separated origins and removes duplicates', () => {
    expect(normalizeOriginAllowlist([
      ' https://example.com,https://staging.example.com',
      'https://example.com\nhttps://internal.example.com, ',
    ])).toEqual([
      'https://example.com',
      'https://staging.example.com',
      'https://internal.example.com',
    ]);
  });
});
