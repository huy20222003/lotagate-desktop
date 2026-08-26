import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureProjectConfig } from './project-config-layout.js';

describe('ensureProjectConfig', () => {
  it('creates the same project-local layout expected by the CLI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-project-config-'));
    try {
      const paths = await ensureProjectConfig(root);
      for (const directory of [paths.directory, paths.skillsDir, paths.pluginsDir, paths.hooksDir]) expect((await stat(directory)).isDirectory()).toBe(true);
      expect(await readFile(paths.gitignore, 'utf8')).toBe('settings.local.json\n');
      expect(JSON.parse(await readFile(paths.settings, 'utf8'))).toEqual({ schemaVersion: 1, permissions: { allow: [], ask: [], deny: [] } });
      expect(JSON.parse(await readFile(paths.localSettings, 'utf8'))).toEqual({ schemaVersion: 1, permissions: { allow: [], ask: [], deny: [] } });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
