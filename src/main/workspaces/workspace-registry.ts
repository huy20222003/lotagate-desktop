import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { workspaceSchema, type Workspace } from '../../contracts/ipc/v1/workspace.js';
import { JsonFileStore } from '../persistence/json-file-store.js';
import { desktopDataPath } from '../persistence/app-data-paths.js';
import { requireDirectory } from '../security/path-policy.js';
import { runGit } from '../git/git-process.js';
import { ensureProjectConfig } from './project-config-layout.js';

export class WorkspaceRegistry {
  private readonly store = new JsonFileStore<Workspace[]>(desktopDataPath('workspaces.json'), [], value => workspaceSchema.array().parse(value));

  async list(): Promise<Workspace[]> { return (await this.store.read()).map(item => workspaceSchema.parse(item)); }

  async add(rootPath: string): Promise<Workspace> {
    const canonical = await requireDirectory(rootPath);
    const gitRoot = await detectGitRoot(canonical);
    const now = new Date().toISOString();
    const workspace = workspaceSchema.parse({ id: randomUUID(), name: canonical.split(/[\\/]/u).pop() ?? canonical, rootPath: canonical, ...(gitRoot === undefined ? {} : { gitRoot }), roots: [canonical], trusted: false, settings: {}, createdAt: now, lastOpenedAt: now });
    let result = workspace;
    await this.store.update(currentItems => {
      const current = currentItems.map(item => workspaceSchema.parse(item));
      const existing = current.find(item => item.rootPath === canonical);
      if (existing) { result = existing; return current; }
      return [...current, workspace];
    });
    return result;
  }

  async remove(workspaceId: string): Promise<void> {
    await this.store.update(current => current.filter(workspace => workspace.id !== workspaceId));
  }

  async addRoot(workspaceId: string, rootPath: string): Promise<Workspace> {
    const canonical = await requireDirectory(rootPath);
    return this.updateWith(workspaceId, workspace => ({ ...workspace, roots: [...new Set([...workspace.roots, canonical])], lastOpenedAt: new Date().toISOString() }));
  }

  async rename(workspaceId: string, name: string): Promise<Workspace> {
    const normalized = name.trim();
    if (normalized.length === 0 || normalized.length > 120) throw new Error('Workspace name must contain 1 to 120 characters.');
    return this.mutate(workspaceId, workspace => ({ ...workspace, name: normalized, lastOpenedAt: new Date().toISOString() }));
  }

  async reorder(workspaceIds: string[]): Promise<Workspace[]> {
    return this.store.update(currentItems => {
      const current = currentItems.map(item => workspaceSchema.parse(item));
      const byId = new Map(current.map(workspace => [workspace.id, workspace]));
      if (workspaceIds.length !== current.length || new Set(workspaceIds).size !== current.length || workspaceIds.some(id => !byId.has(id))) throw new Error('Workspace order does not match the registry.');
      return workspaceIds.map(id => byId.get(id)!);
    });
  }

  async updateSettings(workspaceId: string, patch: Record<string, unknown>): Promise<Workspace> { return this.mutate(workspaceId, workspace => ({ ...workspace, settings: { ...workspace.settings, ...patch }, lastOpenedAt: new Date().toISOString() })); }

  async trust(workspaceId: string, trusted: boolean): Promise<Workspace> {
    const workspace = await this.require(workspaceId);
    if (trusted) await ensureProjectConfig(workspace.rootPath);
    return this.updateWith(workspaceId, workspace => ({ ...workspace, trusted, lastOpenedAt: new Date().toISOString() }));
  }

  async require(workspaceId: string): Promise<Workspace> {
    const workspace = (await this.store.read()).map(item => workspaceSchema.parse(item)).find(item => item.id === workspaceId);
    if (workspace === undefined) throw new Error('Workspace was not found.');
    await access(workspace.rootPath);
    return workspace;
  }

  async requireTrusted(rootPath: string): Promise<void> {
    const canonical = await requireDirectory(rootPath);
    const workspace = (await this.list()).find(item => item.rootPath === canonical || item.roots.includes(canonical));
    if (workspace === undefined) throw new Error('The project is not registered as a workspace.');
    if (!workspace.trusted) throw new Error('Trust this workspace before changing project hooks.');
  }

  private async mutate(workspaceId: string, update: (workspace: Workspace) => Workspace): Promise<Workspace> {
    return this.updateWith(workspaceId, update);
  }

  private async updateWith(workspaceId: string, update: (workspace: Workspace) => Workspace): Promise<Workspace> {
    let updated: Workspace | undefined;
    await this.store.update(current => {
      const index = current.findIndex(workspace => workspace.id === workspaceId);
      if (index < 0) throw new Error('Workspace was not found.');
      updated = workspaceSchema.parse(update(workspaceSchema.parse(current[index])));
      const next = [...current]; next[index] = updated; return next;
    });
    if (!updated) throw new Error('Workspace update failed.');
    return updated;
  }
}

async function detectGitRoot(cwd: string): Promise<string | undefined> {
  try { return (await runGit(['-C', cwd, 'rev-parse', '--show-toplevel'])).trim() || undefined; } catch { return undefined; }
}
