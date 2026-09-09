import { type Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { IGNORED_DIRECTORY_NAMES, MAX_DEPTH, MAX_RESULTS } from './workspace-constants.js';

export interface WorkspaceFileSuggestion {
  path: string;
  kind: 'file' | 'folder';
  hasChildren?: boolean;
}

export class WorkspaceFileSuggestions {
  async list(rootPath: string, query: string): Promise<WorkspaceFileSuggestion[]> {
    const root = resolve(rootPath);
    const normalizedQuery = normalizeQuery(query);
    const results: WorkspaceFileSuggestion[] = [];
    await this.walk(root, root, normalizedQuery, results, 0);
    return results.sort((left, right) => left.kind.localeCompare(right.kind) || left.path.localeCompare(right.path)).slice(0, MAX_RESULTS);
  }

  private async walk(root: string, directory: string, query: string, results: WorkspaceFileSuggestion[], depth: number, entries?: Dirent[]): Promise<void> {
    if (depth > MAX_DEPTH || results.length >= MAX_RESULTS) return;
    const directoryEntries = entries ?? await readDirectoryEntries(directory);
    for (const entry of directoryEntries) {
      if (results.length >= MAX_RESULTS) return;
      if (entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name)) continue;
      const absolutePath = resolve(directory, entry.name);
      const relativePath = relative(root, absolutePath).split(sep).join('/');
      const childEntries = entry.isDirectory() ? await readDirectoryEntries(absolutePath) : undefined;
      if (relativePath.toLowerCase().startsWith(query.toLowerCase())) results.push({ path: relativePath, kind: entry.isDirectory() ? 'folder' : 'file', ...(childEntries === undefined ? {} : { hasChildren: childEntries.length > 0 }) });
      if (childEntries !== undefined) await this.walk(root, absolutePath, query, results, depth + 1, childEntries);
    }
  }
}

async function readDirectoryEntries(directory: string): Promise<Dirent[]> {
  try { return (await readdir(directory, { withFileTypes: true })).filter(entry => !(entry.isDirectory() && IGNORED_DIRECTORY_NAMES.has(entry.name))); }
  catch { return []; }
}

function normalizeQuery(value: string): string {
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\/+/, '');
  if (normalized.includes('..')) return '\uffff';
  return normalized;
}
