import type { FileChangeDiff, WorkspaceFileSuggestion } from '../../../../contracts/ipc/v1/workspace.js';

export type DiffViewMode = 'unified' | 'split';
export interface OpenFileState { status: 'loading' | 'ready' | 'error'; content?: string | undefined; error?: string | undefined }

export const REVIEW_TAB = 'review';
export const FILE_PANEL_DEFAULT_WIDTH = 520;
export const FILE_PANEL_MIN_WIDTH = 360;
export const FILE_PANEL_MAX_WIDTH = 900;
export const CONTEXT_PREVIEW_LINES = 3;

export function clamp(value: number, minimum: number, maximum: number): number { return Math.min(Math.max(value, minimum), maximum); }
export function fileTabValue(path: string): string { return `file:${path}`; }
export function filePathFromTab(value: string): string | undefined { return value.startsWith('file:') ? value.slice(5) : undefined; }
export function fileName(path: string): string { return path.split(/[\\/]/u).pop() || path; }
export function relativeWorkspacePath(cwd: string, path: string): string {
  const normalizedCwd = cwd.replaceAll('\\', '/').replace(/\/+$/u, '');
  const normalizedPath = path.replaceAll('\\', '/');
  const prefix = `${normalizedCwd}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath.replace(/^\/+/, '');
}
export function immediateFolderItems(suggestions: WorkspaceFileSuggestion[], folder: string): WorkspaceFileSuggestion[] {
  const prefix = folder ? `${folder.replaceAll('\\', '/').replace(/\/+$/u, '')}/` : '';
  return suggestions.filter(item => item.path.startsWith(prefix) && !item.path.slice(prefix.length).includes('/'));
}
export function splitDiffLines(lines: readonly FileChangeDiff['lines'][number][]): Array<{ left?: FileChangeDiff['lines'][number]; right?: FileChangeDiff['lines'][number] }> {
  const rows: Array<{ left?: FileChangeDiff['lines'][number]; right?: FileChangeDiff['lines'][number] }> = [];
  for (let index = 0; index < lines.length;) {
    const current = lines[index];
    if (current === undefined) break;
    if (current.kind === 'context') { rows.push({ left: current, right: current }); index += 1; continue; }
    const left: FileChangeDiff['lines'][number][] = [];
    const right: FileChangeDiff['lines'][number][] = [];
    if (current.kind === 'deletion') {
      while (lines[index]?.kind === 'deletion') left.push(lines[index++] as FileChangeDiff['lines'][number]);
      while (lines[index]?.kind === 'addition') right.push(lines[index++] as FileChangeDiff['lines'][number]);
    } else {
      while (lines[index]?.kind === 'addition') right.push(lines[index++] as FileChangeDiff['lines'][number]);
      while (lines[index]?.kind === 'deletion') left.push(lines[index++] as FileChangeDiff['lines'][number]);
    }
    const count = Math.max(left.length, right.length);
    for (let offset = 0; offset < count; offset += 1) rows.push({ ...(left[offset] === undefined ? {} : { left: left[offset] }), ...(right[offset] === undefined ? {} : { right: right[offset] }) });
  }
  return rows;
}
