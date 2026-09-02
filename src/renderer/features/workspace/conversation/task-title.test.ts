import { describe, expect, it } from 'vitest';
import { sessionSlugFromPrompt } from './task-title.js';

describe('sessionSlugFromPrompt', () => {
  it('uses the first prompt as a normalized session slug', () => {
    expect(sessionSlugFromPrompt('  Review\n\n  the protocol  ')).toBe('Review the protocol');
  });

  it('bounds long session slugs without adding an ellipsis suffix', () => {
    const slug = sessionSlugFromPrompt('a'.repeat(100));
    expect(slug).toHaveLength(80);
    expect(slug.endsWith('.')).toBe(false);
  });
});
