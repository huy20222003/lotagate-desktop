import { describe, expect, it } from 'vitest';
import { takeWords } from './text.js';

describe('takeWords', () => {
  it('limits normalized text by words rather than characters', () => {
    expect(takeWords(3, '  One\nlonger   two three four  ')).toBe('One longer two');
  });

  it('returns an empty string for an invalid word limit', () => {
    expect(takeWords(-1, 'text')).toBe('');
  });
});
