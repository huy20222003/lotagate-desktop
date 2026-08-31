import { describe, expect, it } from 'vitest';
import { nextRunAt, validateSchedule } from './schedule.js';

describe('automation schedule', () => {
  it('calculates the next daily run in the configured timezone', () => {
    const from = new Date('2026-08-28T01:00:00.000Z');
    expect(nextRunAt({ kind: 'daily', time: '09:00', timezone: 'Asia/Ho_Chi_Minh' }, from)).toBe('2026-08-28T02:00:00.000Z');
  });

  it('calculates weekly runs and skips the current day after the scheduled time', () => {
    const from = new Date('2026-08-28T03:00:00.000Z');
    expect(nextRunAt({ kind: 'weekly', days: [5], time: '09:00', timezone: 'Asia/Ho_Chi_Minh' }, from)).toBe('2026-09-04T02:00:00.000Z');
  });

  it('supports standard five-field cron expressions', () => {
    const from = new Date('2026-08-28T01:00:00.000Z');
    expect(nextRunAt({ kind: 'cron', expression: '0 9 * * 1-5', timezone: 'Asia/Ho_Chi_Minh' }, from)).toBe('2026-08-28T02:00:00.000Z');
  });

  it('finds sparse leap-day cron schedules beyond a one-year horizon', () => {
    const from = new Date('2026-08-28T01:00:00.000Z');
    expect(nextRunAt({ kind: 'cron', expression: '0 0 29 2 *', timezone: 'UTC' }, from)).toBe('2028-02-29T00:00:00.000Z');
  });

  it('rejects malformed cron expressions and unknown timezones', () => {
    expect(() => validateSchedule({ kind: 'cron', expression: 'every weekday', timezone: 'UTC' })).toThrow('five fields');
    expect(() => validateSchedule({ kind: 'daily', time: '09:00', timezone: 'Not/A-Timezone' })).toThrow('Unknown automation timezone');
  });
});
