import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DesktopLogger } from './desktop-logger.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('DesktopLogger', () => {
  it('writes daily JSONL records without sensitive values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lotagate-logs-'));
    temporaryDirectories.push(directory);
    const logger = new DesktopLogger(directory);
    logger.info('ipc.action.started', { channel: 'auth.login', password: 'secret', prompt: 'private prompt', count: 1 });
    await logger.close();

    const files = await import('node:fs/promises').then(({ readdir }) => readdir(directory));
    expect(files).toHaveLength(1);
    const output = await readFile(join(directory, files[0]!), 'utf8');
    expect(output).toContain('ipc.action.started');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('secret');
    expect(output).not.toContain('private prompt');
  });
});
