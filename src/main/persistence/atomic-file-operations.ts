import { rename } from 'node:fs/promises';

import {
  ATOMIC_RENAME_INITIAL_BACKOFF_MS,
  ATOMIC_RENAME_MAX_ATTEMPTS,
} from './persistence-constants.js';

export interface RenameWithRetryOptions {
  readonly platform?: NodeJS.Platform;
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
  readonly renameFile?: (source: string, destination: string) => Promise<void>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export async function renameWithRetry(
  source: string,
  destination: string,
  options: RenameWithRetryOptions = {},
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const maxAttempts = options.maxAttempts ?? ATOMIC_RENAME_MAX_ATTEMPTS;
  const initialBackoffMs = options.initialBackoffMs ?? ATOMIC_RENAME_INITIAL_BACKOFF_MS;

  validateRetryOptions(maxAttempts, initialBackoffMs);

  const renameFile = options.renameFile ?? rename;
  const sleep = options.sleep ?? delay;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await renameFile(source, destination);
      return;
    } catch (error) {
      const canRetry =
        isWindowsPlatform(platform) &&
        isTransientRenameError(error) &&
        attempt < maxAttempts - 1;

      if (!canRetry) {
        throw error;
      }

      await sleep(initialBackoffMs * 2 ** attempt);
    }
  }
}

export function isTransientRenameError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const code = (error as { readonly code?: unknown }).code;
  return code === 'EBUSY' || code === 'EPERM';
}

function isWindowsPlatform(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'cygwin';
}

function validateRetryOptions(maxAttempts: number, initialBackoffMs: number): void {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts must be a positive integer.');
  }

  if (!Number.isFinite(initialBackoffMs) || initialBackoffMs < 0) {
    throw new RangeError('initialBackoffMs must be a non-negative finite number.');
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
