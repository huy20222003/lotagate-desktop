import { describe, expect, it } from 'vitest';
import { formatDuration, formatTime } from './time.js';

describe('time formatting', () => {
  it.each([
    [0, '0s'], [59_000, '59s'], [83_000, '1m23s'], [3_600_000 + 13 * 60_000 + 23_000, '1h13m23s'], [24 * 3_600_000 + 12 * 3_600_000 + 32 * 60_000 + 12_000, '1d12h32m12s'],
  ])('formats %s milliseconds as %s', (milliseconds, expected) => expect(formatDuration(milliseconds)).toBe(expected));

  it('returns a placeholder for invalid dates', () => expect(formatTime('not-a-date')).toBe('—'));
});
