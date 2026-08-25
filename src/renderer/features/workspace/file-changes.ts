import type { Activity, FileChangeDiff, FileChangeSummary, FileDiffLine, FileDiffLineKind } from '../../../contracts/ipc/v1/workspace.js';

export const EMPTY_FILE_CHANGE_SUMMARY: FileChangeSummary = { files: [], additions: 0, deletions: 0 };

export function fileChangesFromActivities(activities: readonly Activity[]): FileChangeSummary {
  const changes = new Map<string, FileChangeDiff>();
  for (const activity of activities) {
    if (activity.kind !== 'file') continue;
    const change = parseFileChange(activity.metadata['change']);
    if (change !== undefined) changes.set(change.path, change);
  }
  return summarize(changes);
}

export function mergeFileChange(summary: FileChangeSummary, value: unknown): FileChangeSummary {
  const change = parseFileChange(value);
  if (change === undefined) return summary;
  const changes = new Map(summary.files.map(item => [item.path, item]));
  changes.set(change.path, change);
  return summarize(changes);
}

function summarize(changes: ReadonlyMap<string, FileChangeDiff>): FileChangeSummary {
  const files = [...changes.values()].sort((left, right) => left.path.localeCompare(right.path));
  return { files, additions: files.reduce((total, item) => total + item.additions, 0), deletions: files.reduce((total, item) => total + item.deletions, 0) };
}

function parseFileChange(value: unknown): FileChangeDiff | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const path = typeof record['path'] === 'string' && record['path'].trim() ? record['path'] : undefined;
  const lines = Array.isArray(record['lines']) ? record['lines'].flatMap(parseLine) : [];
  if (path === undefined) return undefined;
  const additions = readCount(record['additions'], lines, 'addition');
  const deletions = readCount(record['deletions'], lines, 'deletion');
  return { path, lines, additions, deletions, truncated: record['truncated'] === true };
}

function parseLine(value: unknown): FileDiffLine[] {
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  const kind = record['kind'];
  const text = record['text'];
  if (!isLineKind(kind) || typeof text !== 'string') return [];
  return [{ kind, text: text.slice(0, 16_384), ...readLineNumber(record['oldLine'], 'oldLine'), ...readLineNumber(record['newLine'], 'newLine') }];
}

function readLineNumber(value: unknown, key: 'oldLine' | 'newLine'): Partial<Pick<FileDiffLine, 'oldLine' | 'newLine'>> {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? { [key]: value } : {};
}

function isLineKind(value: unknown): value is FileDiffLineKind { return value === 'context' || value === 'addition' || value === 'deletion'; }
function readCount(value: unknown, lines: readonly FileDiffLine[], kind: FileDiffLineKind): number { return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : lines.filter(line => line.kind === kind).length; }
