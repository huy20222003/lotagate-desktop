import { describe, expect, it, vi } from 'vitest';

import { renameWithRetry } from './atomic-file-operations.js';

describe('renameWithRetry', () => {
  it('retries transient Windows rename failures with exponential backoff', async () => {
    let attempts = 0;
    const renameFile = vi.fn(async (_source: string, _destination: string) => {
      attempts += 1;
      if (attempts < 3) {
        throw { code: attempts === 1 ? 'EPERM' : 'EBUSY' };
      }
    });
    const sleep = vi.fn(async (_milliseconds: number) => undefined);

    await renameWithRetry('source', 'destination', {
      platform: 'win32',
      initialBackoffMs: 4,
      renameFile,
      sleep,
    });

    expect(renameFile).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 4);
    expect(sleep).toHaveBeenNthCalledWith(2, 8);
  });

  it('does not retry transient failures on non-Windows platforms', async () => {
    const error = { code: 'EPERM' };
    const renameFile = vi.fn(async (_source: string, _destination: string) => {
      throw error;
    });
    const sleep = vi.fn(async (_milliseconds: number) => undefined);

    await expect(
      renameWithRetry('source', 'destination', {
        platform: 'linux',
        renameFile,
        sleep,
      }),
    ).rejects.toBe(error);

    expect(renameFile).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('rethrows the final transient error after the configured attempts', async () => {
    const error = { code: 'EBUSY' };
    const renameFile = vi.fn(async (_source: string, _destination: string) => {
      throw error;
    });
    const sleep = vi.fn(async (_milliseconds: number) => undefined);

    await expect(
      renameWithRetry('source', 'destination', {
        platform: 'win32',
        maxAttempts: 3,
        renameFile,
        sleep,
      }),
    ).rejects.toBe(error);

    expect(renameFile).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
