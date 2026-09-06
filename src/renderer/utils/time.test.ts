import { describe, expect, it } from 'vitest';
import { formatConversationTimeSeparator, formatDuration, formatMessageTime, formatTime } from './time.js';

describe('time formatting', () => {
  it.each([
    [0, '0s'], [59_000, '59s'], [83_000, '1m23s'], [3_600_000 + 13 * 60_000 + 23_000, '1h13m23s'], [24 * 3_600_000 + 12 * 3_600_000 + 32 * 60_000 + 12_000, '1d12h32m12s'],
  ])('formats %s milliseconds as %s', (milliseconds, expected) => expect(formatDuration(milliseconds)).toBe(expected));

  it('returns a placeholder for invalid dates', () => expect(formatTime('not-a-date')).toBe('—'));

  it('formats message times as a clock time for today and a short date for older messages', () => {
    const now = new Date(2026, 8, 5, 12, 0);

    expect(formatMessageTime(new Date(2026, 8, 5, 21, 50), now)).toBe('9:50 PM');
    expect(formatMessageTime(new Date(2026, 7, 22, 15, 50), now)).toBe('Aug 22, 3:50 PM');
  });

  it('formats conversation separators with Today for the current calendar day', () => {
    const now = new Date(2026, 8, 5, 12, 0);

    expect(formatConversationTimeSeparator(new Date(2026, 8, 5, 15, 1), now)).toBe('Today, 3:01 PM');
    expect(formatConversationTimeSeparator(new Date(2026, 7, 22, 4, 56), now)).toBe('Aug 22, 4:56 AM');
  });
});
