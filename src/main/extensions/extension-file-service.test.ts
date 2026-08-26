import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExtensionFileService } from './extension-file-service.js';
import { ensureProjectConfig } from '../workspaces/project-config-layout.js';

describe('ExtensionFileService', () => {
  it('reads and updates only the selected MCP entry through the main process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-extension-file-'));
    try {
      const paths = await ensureProjectConfig(root);
      await writeFile(paths.mcpConfig, JSON.stringify({ docs: { enabled: true, config: { type: 'http', url: 'https://old.example/mcp' } }, keep: { enabled: true, config: { type: 'sse', url: 'https://keep.example/mcp' } } }));
      const service = new ExtensionFileService();
      const detail = await service.readDetail({ kind: 'mcp', cwd: root, name: 'docs', scope: 'project' });
      expect(JSON.parse(detail.content).config.url).toBe('https://old.example/mcp');
      await service.writeDetail({ kind: 'mcp', cwd: root, name: 'docs', scope: 'project', content: JSON.stringify({ enabled: false, config: { type: 'http', url: 'https://new.example/mcp' } }) });
      const updated = JSON.parse(await readFile(paths.mcpConfig, 'utf8')) as Record<string, { enabled: boolean; config: { url: string } }>;
      expect(updated['docs']?.enabled).toBe(false);
      expect(updated['docs']?.config.url).toBe('https://new.example/mcp');
      expect(updated['keep']?.config.url).toBe('https://keep.example/mcp');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('reads package-provided skills without treating them as workspace files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-builtin-skill-'));
    try {
      const detail = await new ExtensionFileService().readDetail({ kind: 'skill', cwd: root, name: 'api-contract-review', scope: 'builtin' });
      expect(detail.format).toBe('markdown');
      expect(detail.editable).toBe(false);
      expect(detail.fileName).toBe('SKILL.md');
      expect(detail.content).toContain('name: api-contract-review');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('does not create an override when a package-provided skill is edited', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-builtin-skill-readonly-'));
    try {
      const service = new ExtensionFileService();
      await expect(service.writeDetail({ kind: 'skill', cwd: root, name: 'api-contract-review', scope: 'builtin', content: 'invalid' })).rejects.toThrow('cannot be edited');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('creates, reads, updates, and removes trusted project hooks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-hook-crud-'));
    try {
      const service = new ExtensionFileService({ requireTrusted: async () => undefined });
      const created = await service.createHook({ cwd: root, event: 'tool.before', command: 'node', args: ['hook.mjs'], timeoutMs: 5000 });
      expect(created.name).toMatch(/^hook-[0-9a-f-]+$/u);
      expect(await service.listProjectHooks(root)).toEqual([created.name]);
      const detail = await service.readDetail({ kind: 'hook', cwd: root, name: created.name, scope: 'project' });
      expect(JSON.parse(detail.content)).toEqual({ event: 'tool.before', command: 'node', args: ['hook.mjs'], timeoutMs: 5000 });
      await service.writeDetail({ kind: 'hook', cwd: root, name: created.name, scope: 'project', content: JSON.stringify({ event: 'tool.after', command: 'node', args: ['after.mjs'], timeoutMs: 7000 }) });
      expect(JSON.parse((await service.readDetail({ kind: 'hook', cwd: root, name: created.name, scope: 'project' })).content)).toMatchObject({ event: 'tool.after', timeoutMs: 7000 });
      await service.removeHook({ cwd: root, name: created.name });
      await expect(service.readDetail({ kind: 'hook', cwd: root, name: created.name, scope: 'project' })).resolves.toMatchObject({ editable: false });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects hook mutations when the project is not trusted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-hook-untrusted-'));
    try {
      const service = new ExtensionFileService({ requireTrusted: async () => { throw new Error('Trust this workspace before changing project hooks.'); } });
      await expect(service.createHook({ cwd: root, event: 'session.start', command: 'node', args: [], timeoutMs: 10000 })).rejects.toThrow('Trust this workspace');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
