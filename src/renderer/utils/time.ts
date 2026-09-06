export interface TimeFormatOptions extends Intl.DateTimeFormatOptions {}

const MESSAGE_TIME_LOCALE = 'en-US';
const MESSAGE_CLOCK_OPTIONS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
const MESSAGE_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

export function formatTime(value: string | number | Date, options: TimeFormatOptions = { hour: '2-digit', minute: '2-digit' }): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function formatMessageTime(value: string | number | Date, now: Date = new Date()): string {
  const date = toValidDate(value);
  if (date === undefined) return '—';
  const options = isSameCalendarDay(date, now) ? MESSAGE_CLOCK_OPTIONS : MESSAGE_DATE_TIME_OPTIONS;
  return new Intl.DateTimeFormat(MESSAGE_TIME_LOCALE, options).format(date);
}

export function formatConversationTimeSeparator(value: string | number | Date, now: Date = new Date()): string {
  const date = toValidDate(value);
  if (date === undefined) return '—';
  const time = new Intl.DateTimeFormat(MESSAGE_TIME_LOCALE, MESSAGE_CLOCK_OPTIONS).format(date);
  return isSameCalendarDay(date, now) ? `Today, ${time}` : new Intl.DateTimeFormat(MESSAGE_TIME_LOCALE, MESSAGE_DATE_TIME_OPTIONS).format(date);
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join('');
}

function toValidDate(value: string | number | Date): Date | undefined {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}
