import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { desktopDataDirectory, DESKTOP_DATA_DIRECTORIES } from '../persistence/app-data-paths.js';

const LOG_RETENTION_DAYS = 30;
const MAX_STRING_LENGTH = 1_024;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /(authorization|cookie|credential|password|passphrase|secret|token|api[-_]?key|private[-_]?key|file[-_]?data|prompt|content|base64)/iu;
const LOG_FILE_PATTERN = /^desktop-(\d{4}-\d{2}-\d{2})\.log$/u;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogDetails {
  [key: string]: unknown;
}

export class DesktopLogger {
  private writeChain: Promise<void> = Promise.resolve();
  private lastPrunedDate: string | undefined;
  private retentionDays = LOG_RETENTION_DAYS;

  constructor(private readonly directory = desktopDataDirectory(DESKTOP_DATA_DIRECTORIES.logs)) {}

  debug(event: string, details?: LogDetails): void { this.enqueue('debug', event, details); }
  info(event: string, details?: LogDetails): void { this.enqueue('info', event, details); }
  warn(event: string, details?: LogDetails): void { this.enqueue('warn', event, details); }
  error(event: string, details?: LogDetails): void { this.enqueue('error', event, details); }
  setRetentionDays(days: number): void { if (Number.isInteger(days) && days >= 1 && days <= 365) this.retentionDays = days; }

  async close(): Promise<void> {
    await this.writeChain;
  }

  private enqueue(level: LogLevel, event: string, details?: LogDetails): void {
    const next = this.writeChain
      .catch(() => undefined)
      .then(() => this.write(level, event, details));
    this.writeChain = next;
  }

  private async write(level: LogLevel, event: string, details?: LogDetails): Promise<void> {
    const timestamp = new Date();
    const date = timestamp.toISOString().slice(0, 10);
    await mkdir(this.directory, { recursive: true });
    if (this.lastPrunedDate !== date) {
      this.lastPrunedDate = date;
      await this.prune(this.directory, date);
    }
    const record = {
      timestamp: timestamp.toISOString(),
      level,
      event,
      ...(details === undefined ? {} : { details: redactRecord(details) }),
    };
    await appendFile(join(this.directory, `desktop-${date}.log`), `${JSON.stringify(record)}\n`, 'utf8');
  }

  private async prune(directory: string, today: string): Promise<void> {
    const cutoff = Date.parse(`${today}T00:00:00.000Z`) - this.retentionDays * 24 * 60 * 60 * 1_000;
    const files = await readdir(directory, { withFileTypes: true });
    await Promise.all(files.flatMap(file => {
      if (!file.isFile()) return [];
      const match = file.name.match(LOG_FILE_PATTERN);
      if (!match || Date.parse(`${match[1]}T00:00:00.000Z`) >= cutoff) return [];
      return [unlink(join(directory, file.name)).catch(() => undefined)];
    }));
  }
}

function redactRecord(value: LogDetails): LogDetails {
  return redactValue(value) as LogDetails;
}

function redactValue(value: unknown, key?: string): unknown {
  if (key !== undefined && SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => redactValue(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
}
