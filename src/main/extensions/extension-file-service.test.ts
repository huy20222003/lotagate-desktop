import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExtensionFileService } from './extension-file-service.js';
import { ensureProjectConfig } from '../workspaces/project-config-layout.js';

describe('ExtensionFileService', () => {
  it('builds the public plugin catalog from packaged plugin directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-public-plugin-catalog-'));
    try {
      const plugin = join(root, 'computer-use');
      await mkdir(join(plugin, '.lotagate-plugin'), { recursive: true });
      await mkdir(join(plugin, 'skills', 'computer-use'), { recursive: true });
      await writeFile(join(plugin, '.lotagate-plugin', 'plugin.json'), JSON.stringify({ name: 'computer-use', version: '1.0.0', description: 'Control Windows applications.', author: 'LotaGate', license: 'MIT' }));
      await writeFile(join(plugin, 'skills', 'computer-use', 'SKILL.md'), '---\nname: computer-use\ndescription: Control Windows applications.\n---\nUse computer tools.');
      await writeFile(join(plugin, 'README.md'), '# Computer Use');
      await writeFile(join(plugin, 'LICENSE'), 'MIT');
      const catalog = await new ExtensionFileService(undefined, root).listPublicPlugins();
      expect(catalog).toEqual([expect.objectContaining({ directory: 'computer-use', name: 'computer-use', version: '1.0.0', description: 'Control Windows applications.', author: 'LotaGate', license: 'MIT', contributions: [{ kind: 'skill', sourceName: 'computer-use', description: 'Control Windows applications.' }] })]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('resolves only curated public plugin directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-public-plugins-'));
    try {
      const plugin = join(root, 'workspace-review');
      await mkdir(join(plugin, '.lotagate-plugin'), { recursive: true });
      await mkdir(join(plugin, 'skills', 'review-workspace'), { recursive: true });
      await writeFile(join(plugin, '.lotagate-plugin', 'plugin.json'), JSON.stringify({ name: 'workspace-review', version: '1.0.0' }));
      await writeFile(join(plugin, 'skills', 'review-workspace', 'SKILL.md'), '---\nname: review-workspace\ndescription: Review workspace\n---\nRead-only preview');
      const service = new ExtensionFileService(undefined, root);
      await expect(service.resolvePublicPluginSource('workspace-review')).resolves.toBe(await realpath(plugin));
      await expect(service.readPublicPluginContribution({ pluginName: 'workspace-review', kind: 'skill', sourceName: 'review-workspace' })).resolves.toMatchObject({ format: 'markdown', editable: false, fileName: 'SKILL.md' });
      await expect(service.resolvePublicPluginSource('../outside')).rejects.toThrow('Invalid public plugin name');
      await expect(service.resolvePublicPluginSource('missing')).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

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

  it('reads plugin-owned skill and MCP details from the canonical plugin folders', async () => {
      const root = await mkdtemp(join(tmpdir(), 'lotagate-plugin-detail-'));
    try {
      const plugin = join(root, '.lotagate', 'plugins', 'example');
      await ensureProjectConfig(root);
      await mkdir(join(plugin, '.lotagate-plugin'), { recursive: true });
      await mkdir(join(plugin, 'skills', 'review'), { recursive: true });
      await mkdir(join(plugin, 'mcp'), { recursive: true });
      await writeFile(join(plugin, '.lotagate-plugin', 'plugin.json'), JSON.stringify({ name: 'example', version: '1.0.0' }));
      await writeFile(join(plugin, 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Review\n---\nReview instructions.');
      await writeFile(join(plugin, 'mcp', 'docs.json'), JSON.stringify({ enabled: true, config: { type: 'http', url: 'https://example.test/mcp' } }));
      const service = new ExtensionFileService();
      const skill = await service.readDetail({ kind: 'skill', cwd: root, name: 'example:review', scope: 'plugin', pluginName: 'example', sourceName: 'review' });
      expect(skill.content).toContain('name: review');
      expect(skill.editable).toBe(false);
      const mcp = await service.readDetail({ kind: 'mcp', cwd: root, name: 'plugin_example_docs', scope: 'plugin', pluginName: 'example', sourceName: 'docs' });
      expect(JSON.parse(mcp.content).config.url).toBe('https://example.test/mcp');
      expect(mcp.editable).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('reads an optional plugin SVG icon and ignores invalid or oversized icons', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lotagate-plugin-icon-'));
    try {
      const plugin = join(root, '.lotagate', 'plugins', 'example');
      await ensureProjectConfig(root);
      await mkdir(join(plugin, '.lotagate-plugin'), { recursive: true });
      await writeFile(join(plugin, '.lotagate-plugin', 'plugin.json'), JSON.stringify({ name: 'example', version: '1.0.0' }));
      await writeFile(join(plugin, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" /></svg>');
      const icon = await new ExtensionFileService().readPluginIcon({ cwd: root, name: 'example', scope: 'project' });
      expect(icon?.mimeType).toBe('image/svg+xml');
      expect(Buffer.from(icon?.data ?? '', 'base64').toString('utf8')).toContain('<svg');
      await writeFile(join(plugin, 'icon.svg'), 'not an svg');
      await expect(new ExtensionFileService().readPluginIcon({ cwd: root, name: 'example', scope: 'project' })).resolves.toBeUndefined();
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
      const created = await service.createHook({ cwd: root, name: 'audit-hook', event: 'tool.before', command: 'node', args: ['hook.mjs'], timeoutMs: 5000 });
      expect(created.name).toBe('audit-hook');
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
      await expect(service.createHook({ cwd: root, name: 'startup-hook', event: 'session.start', command: 'node', args: [], timeoutMs: 10000 })).rejects.toThrow('Trust this workspace');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
