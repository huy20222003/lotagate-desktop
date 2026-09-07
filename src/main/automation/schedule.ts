import type { AutomationSchedule } from '../../contracts/ipc/v1/automation.js';
import { CRON_SEARCH_DAYS } from './automation-constants.js';

type CalendarParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
type CronField = Set<number>;
type CronExpression = { minute: CronField; hour: CronField; dayOfMonth: CronField; month: CronField; dayOfWeek: CronField; dayOfMonthWildcard: boolean; dayOfWeekWildcard: boolean };
export function nextRunAt(schedule: AutomationSchedule, from = new Date()): string | null {
  if (schedule.kind === 'manual') return null;
  if (schedule.kind === 'once') return Date.parse(schedule.at) > from.getTime() ? new Date(schedule.at).toISOString() : null;
  assertTimezone(schedule.timezone);
  if (schedule.kind === 'interval') return nextInterval(schedule.everyMinutes, schedule.startAt, from);
  if (schedule.kind === 'daily') return nextDaily(schedule.time, schedule.timezone, from);
  if (schedule.kind === 'weekly') return nextWeekly(schedule.days, schedule.time, schedule.timezone, from);
  return nextCron(parseCron(schedule.expression), schedule.timezone, from);
}

export function validateSchedule(schedule: AutomationSchedule): void {
  if (schedule.kind === 'cron') parseCron(schedule.expression);
  if (schedule.kind !== 'manual' && schedule.kind !== 'once') assertTimezone(schedule.timezone);
  if (schedule.kind === 'once' && Number.isNaN(Date.parse(schedule.at))) throw new Error('Automation schedule time is invalid.');
}

function nextInterval(everyMinutes: number, startAt: string | undefined, from: Date): string {
  const anchor = startAt === undefined ? from.getTime() : Date.parse(startAt);
  if (Number.isNaN(anchor)) throw new Error('Automation interval start time is invalid.');
  const intervalMs = everyMinutes * 60_000;
  const next = anchor > from.getTime() ? anchor : anchor + (Math.floor((from.getTime() - anchor) / intervalMs) + 1) * intervalMs;
  return new Date(next).toISOString();
}

function nextDaily(time: string, timezone: string, from: Date): string {
  const parts = parseTime(time);
  const today = zonedParts(from, timezone);
  let candidate = zonedDateToUtc({ ...today, ...parts, second: 0 }, timezone);
  if (candidate.getTime() <= from.getTime()) candidate = zonedDateToUtc({ ...addCalendarDays(today, 1), ...parts, second: 0 }, timezone);
  return candidate.toISOString();
}

function nextWeekly(days: number[], time: string, timezone: string, from: Date): string {
  const parts = parseTime(time);
  const today = zonedParts(from, timezone);
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = addCalendarDays(today, offset);
    const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
    if (!days.includes(weekday)) continue;
    const candidate = zonedDateToUtc({ ...date, ...parts, second: 0 }, timezone);
    if (candidate.getTime() > from.getTime()) return candidate.toISOString();
  }
  throw new Error('Unable to calculate the next weekly automation run.');
}

function nextCron(expression: CronExpression, timezone: string, from: Date): string | null {
  const formatter = createZonedFormatter(timezone);
  const today = zonedParts(from, timezone, formatter);
  const hours = [...expression.hour].sort((left, right) => left - right);
  const minutes = [...expression.minute].sort((left, right) => left - right);
  for (let offset = 0; offset <= CRON_SEARCH_DAYS; offset += 1) {
    const date = addCalendarDays(today, offset);
    if (!expression.month.has(date.month)) continue;
    const domMatches = expression.dayOfMonth.has(date.day);
    const dowMatches = expression.dayOfWeek.has(new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay());
    const dayMatches = expression.dayOfMonthWildcard || expression.dayOfWeekWildcard ? domMatches && dowMatches : domMatches || dowMatches;
    if (!dayMatches) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        const candidate = zonedDateToUtc({ ...date, hour, minute, second: 0 }, timezone, formatter);
        const actual = zonedParts(candidate, timezone, formatter);
        if (candidate.getTime() > from.getTime() && actual.year === date.year && actual.month === date.month && actual.day === date.day && actual.hour === hour && actual.minute === minute) return candidate.toISOString();
      }
    }
  }
  return null;
}

function parseCron(expression: string): CronExpression {
  const fields = expression.trim().split(/\s+/u);
  if (fields.length !== 5) throw new Error('Cron schedule must contain five fields.');
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) throw new Error('Cron schedule is incomplete.');
  return {
    minute: parseCronField(minute, 0, 59), hour: parseCronField(hour, 0, 23), dayOfMonth: parseCronField(dayOfMonth, 1, 31), month: parseCronField(month, 1, 12), dayOfWeek: parseCronField(dayOfWeek, 0, 6, true),
    dayOfMonthWildcard: dayOfMonth === '*', dayOfWeekWildcard: dayOfWeek === '*',
  };
}

function parseCronField(value: string, min: number, max: number, sundayAlias = false): CronField {
  const result = new Set<number>();
  for (const part of value.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    if (rangePart === undefined) throw new Error('Cron field is invalid.');
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error('Cron step is invalid.');
    const [startText, endText] = rangePart === '*' ? [String(min), String(max)] : rangePart.split('-');
    const start = Number(startText);
    const end = endText === undefined ? start : Number(endText);
    const normalizedStart = sundayAlias && start === 7 ? 0 : start;
    const normalizedEnd = sundayAlias && end === 7 ? 0 : end;
    if (!Number.isInteger(normalizedStart) || !Number.isInteger(normalizedEnd) || normalizedStart < min || normalizedEnd > max || normalizedStart > normalizedEnd) throw new Error('Cron field is invalid.');
    for (let item = normalizedStart; item <= normalizedEnd; item += step) result.add(item);
  }
  if (result.size === 0) throw new Error('Cron field is empty.');
  return result;
}

function parseTime(value: string): { hour: number; minute: number } { const [hour, minute] = value.split(':').map(Number); return { hour: hour!, minute: minute! }; }
function addCalendarDays(parts: CalendarParts, days: number): CalendarParts { const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)); return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: parts.hour, minute: parts.minute, second: parts.second }; }

function createZonedFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
}

function zonedParts(date: Date, timezone: string, formatter = createZonedFormatter(timezone)): CalendarParts {
  const values = Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return { year: values['year']!, month: values['month']!, day: values['day']!, hour: values['hour']!, minute: values['minute']!, second: values['second']! };
}

function zonedDateToUtc(target: CalendarParts, timezone: string, formatter = createZonedFormatter(timezone)): Date {
  let guess = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const actual = zonedParts(new Date(guess), timezone, formatter);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    guess += Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second) - actualAsUtc;
  }
  return new Date(guess);
}

function assertTimezone(timezone: string): void { try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(); } catch { throw new Error(`Unknown automation timezone: ${timezone}.`); } }
