import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactService } from './artifact-service.js';
import { DESKTOP_RUNTIME_LIMITS } from '../../contracts/runtime-limits.js';

vi.mock('electron', () => ({ app: { getPath: () => process.cwd() } }));

describe('ArtifactService.importFile', () => {
  it('rejects oversized files before copying them into desktop storage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lotagate-artifact-'));
    const source = join(directory, 'large.bin');
    await writeFile(source, '');
    await truncate(source, DESKTOP_RUNTIME_LIMITS.artifactFileBytes + 1);
    try {
      await expect(new ArtifactService().importFile('task-1', source, 'binary')).rejects.toThrow('size limit');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
