import { describe, expect, it } from 'vitest';
import { formatTextClamp } from './text.js';

describe('formatTextClamp', () => {
  it('keeps text within the requested character limit', () => {
    expect(formatTextClamp(5, 'hello world')).toBe('hello....');
  });

  it('returns the original text when it fits', () => {
    expect(formatTextClamp(20, 'hello')).toBe('hello');
  });
});
