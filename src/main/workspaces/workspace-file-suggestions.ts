import { readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const MAX_RESULTS = 80;
const MAX_DEPTH = 8;
const IGNORED_DIRECTORY_NAMES = new Set(['.git', '.hg', '.svn', 'node_modules', 'out', 'dist', 'build', '.vite']);

export interface WorkspaceFileSuggestion {
  path: string;
  kind: 'file' | 'folder';
}

export class WorkspaceFileSuggestions {
  async list(rootPath: string, query: string): Promise<WorkspaceFileSuggestion[]> {
    const root = resolve(rootPath);
    const normalizedQuery = normalizeQuery(query);
    const results: WorkspaceFileSuggestion[] = [];
    await this.walk(root, root, normalizedQuery, results, 0);
    return results.sort((left, right) => left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path)).slice(0, MAX_RESULTS);
  }

  private async walk(root: string, directory: string, query: string, results: WorkspaceFileSuggestion[], depth: number): Promise<void> {
    if (depth > MAX_DEPTH || results.length >= MAX_RESULTS) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) return;
      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
      const absolutePath = resolve(directory, entry.name);
      const relativePath = relative(root, absolutePath).split(sep).join('/');
      if (relativePath.toLowerCase().startsWith(query.toLowerCase())) results.push({ path: relativePath, kind: entry.isDirectory() ? 'folder' : 'file' });
      if (entry.isDirectory()) await this.walk(root, absolutePath, query, results, depth + 1);
    }
  }
}

function normalizeQuery(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\/+/, '');
  if (normalized.includes('..')) return '\uffff';
  return normalized;
}
