import { executeDesktopCommandResult, findDesktopCommand, listDesktopCommands } from '../../services/desktop-command-client.js';

export type MemoryState = 'active' | 'superseded' | 'expired';

export interface MemoryRow {
  id: string;
  kind: string;
  state: MemoryState;
  statement: string;
  rationale?: string;
  topics: string[];
  source: string;
  evidenceRefs: string[];
  supersedes: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  lastRetrievedAt?: string;
  retrievalCount: number;
}

export interface MemoryExport { bundle: Record<string, unknown>; }

/** Resolves command ids from the CLI catalog so Desktop never owns a duplicate command registry. */
export class MemoryCommandClient {
  async list(cwd: string): Promise<MemoryRow[]> {
    return parseMemoryRows((await this.execute(cwd, ['memory', 'list'], [], {})).structured);
  }

  async forget(cwd: string, id: string): Promise<boolean> {
    const result = await this.execute(cwd, ['memory', 'forget'], [id], {});
    return result.structured?.['forgotten'] === true;
  }

  async show(cwd: string, id: string): Promise<MemoryRow | undefined> {
    const result = await this.execute(cwd, ['memory', 'show'], [id], {});
    const payload = readRecord(result.structured);
    return payload?.['kind'] === 'memory.show' ? parseRow(payload['item'])[0] : undefined;
  }

  async clear(cwd: string): Promise<number> {
    const result = await this.execute(cwd, ['memory', 'clear'], [], {});
    return readNonNegativeInteger(result.structured?.['cleared']) ?? 0;
  }

  async export(cwd: string, outputPath?: string): Promise<MemoryExport | undefined> {
    const result = await this.execute(cwd, ['memory', 'export'], [], outputPath === undefined ? {} : { out: outputPath });
    const bundle = readRecord(result.structured?.['bundle']);
    return bundle === undefined ? undefined : { bundle };
  }

  async previewImport(cwd: string, file: string): Promise<number> {
    const result = await this.execute(cwd, ['memory', 'import'], [], { file });
    return readNonNegativeInteger(result.structured?.['records']) ?? 0;
  }

  async import(cwd: string, file: string): Promise<{ imported: number; skipped: number }> {
    const result = await this.execute(cwd, ['memory', 'import'], [], { file, apply: true });
    return { imported: readNonNegativeInteger(result.structured?.['imported']) ?? 0, skipped: readNonNegativeInteger(result.structured?.['skipped']) ?? 0 };
  }

  private async execute(cwd: string, path: readonly string[], positionals: string[], options: Record<string, string | boolean>) {
    const command = findDesktopCommand(await listDesktopCommands(cwd), path);
    if (command === undefined) throw new Error(`The installed CLI does not provide the ${path.join(' ')} command.`);
    return executeDesktopCommandResult(cwd, { actionId: command.id, positionals, options });
  }
}

export function parseMemoryRows(value: unknown): MemoryRow[] {
  const payload = readRecord(value);
  if (payload?.['kind'] !== 'memory.list' || !Array.isArray(payload['items'])) return [];
  return payload['items'].flatMap(parseRow);
}

function parseRow(value: unknown): MemoryRow[] {
  const record = readRecord(value);
  if (record === undefined) return [];
  const id = readString(record['id']); const kind = readKind(record['kind']); const state = readState(record['state']); const statement = readString(record['statement']); const updatedAt = readString(record['updatedAt']); const createdAt = readString(record['createdAt']); const source = readIdentifier(record['source']); const retrievalCount = readNonNegativeInteger(record['retrievalCount']);
  if (id === undefined || kind === undefined || state === undefined || statement === undefined || updatedAt === undefined || createdAt === undefined || source === undefined || retrievalCount === undefined) return [];
  const rationale = readString(record['rationale']); const expiresAt = readString(record['expiresAt']); const lastRetrievedAt = readString(record['lastRetrievedAt']); const topics = readStringList(record['topics']); const evidenceRefs = readStringList(record['evidenceRefs']); const supersedes = readStringList(record['supersedes']);
  if (topics === undefined || evidenceRefs === undefined || supersedes === undefined) return [];
  return [{ id, kind, state, statement, createdAt, updatedAt, source, topics, evidenceRefs, supersedes, retrievalCount, ...(rationale === undefined ? {} : { rationale }), ...(expiresAt === undefined ? {} : { expiresAt }), ...(lastRetrievedAt === undefined ? {} : { lastRetrievedAt }) }];
}

function readRecord(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function readString(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
function readNonNegativeInteger(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
function readKind(value: unknown): MemoryRow['kind'] | undefined { return readIdentifier(value); }
function readState(value: unknown): MemoryState | undefined { return value === 'active' || value === 'superseded' || value === 'expired' ? value : undefined; }
function readIdentifier(value: unknown): string | undefined { return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u.test(value) ? value : undefined; }
function readStringList(value: unknown): string[] | undefined { return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined; }
