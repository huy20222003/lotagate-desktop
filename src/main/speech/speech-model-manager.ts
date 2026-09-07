import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

const MAX_MODEL_BYTES = 512 * 1024 * 1024;

interface SpeechModelManifestFile {
  version: number;
  model: { file: string; url: string; sha256: string; sizeBytes: number };
}

interface SpeechModelManagerOptions {
  resourceRoot: string;
  cacheRoot: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export class SpeechModelManager {
  private ensureOperation: Promise<string> | undefined;

  constructor(private readonly options: SpeechModelManagerOptions) {}

  ensureModel(): Promise<string> {
    if (this.ensureOperation === undefined) {
      this.ensureOperation = this.ensureModelOnce().finally(() => { this.ensureOperation = undefined; });
    }
    return this.ensureOperation;
  }

  private async ensureModelOnce(): Promise<string> {
    const manifest = await readManifest(join(this.options.resourceRoot, 'manifest.json'));
    const model = manifest.model;
    const cachePath = join(this.options.cacheRoot, model.file);
    await mkdir(this.options.cacheRoot, { recursive: true });
    if (await matchesExpectedModel(cachePath, model)) return cachePath;

    const temporaryPath = `${cachePath}.download-${process.pid}-${Date.now()}`;
    try {
      await downloadModel(model, temporaryPath, this.options.fetch ?? fetch);
      await rm(cachePath, { force: true });
      await rename(temporaryPath, cachePath);
      return cachePath;
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

async function readManifest(path: string): Promise<SpeechModelManifestFile> {
  let value: unknown;
  try { value = JSON.parse(await readFile(path, 'utf8')); } catch (error) { throw new Error(`The speech runtime manifest is unavailable: ${describe(error)}.`); }
  if (!isRecord(value) || value['version'] !== 1 || !isRecord(value['model'])) throw new Error('The speech runtime manifest is invalid.');
  const model = value['model'];
  const file = model['file'];
  const url = model['url'];
  const sha256 = model['sha256'];
  const sizeBytes = model['sizeBytes'];
  if (typeof file !== 'string' || basename(file) !== file || !/^[A-Za-z0-9._-]+$/u.test(file) || typeof url !== 'string' || !isHttpsUrl(url) || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256) || typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_MODEL_BYTES) throw new Error('The speech model manifest contains invalid model metadata.');
  return { version: 1, model: { file, url, sha256, sizeBytes } };
}

async function matchesExpectedModel(path: string, model: SpeechModelManifestFile['model']): Promise<boolean> {
  try {
    const information = await stat(path);
    if (!information.isFile() || information.size !== model.sizeBytes) return false;
    return createHash('sha256').update(await readFile(path)).digest('hex') === model.sha256;
  } catch { return false; }
}

async function downloadModel(model: SpeechModelManifestFile['model'], destination: string, fetchModel: NonNullable<SpeechModelManagerOptions['fetch']>): Promise<void> {
  const response = await fetchModel(model.url, { redirect: 'follow', headers: { 'user-agent': 'LotaGate-Desktop-Speech' } });
  if (!response.ok) throw new Error(`Speech model download failed with HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_MODEL_BYTES || (declaredLength > 0 && declaredLength !== model.sizeBytes)) throw new Error('The speech model response size does not match its manifest.');
  if (response.body === null) throw new Error('The speech model download returned no data.');

  const handle = await open(destination, 'w');
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > model.sizeBytes || bytes > MAX_MODEL_BYTES) throw new Error('The speech model exceeds its declared size.');
      hash.update(chunk.value);
      await handle.write(chunk.value);
    }
  } finally { await handle.close(); }
  if (bytes !== model.sizeBytes || hash.digest('hex') !== model.sha256) throw new Error('The downloaded speech model failed integrity validation.');
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isHttpsUrl(value: string): boolean { try { return new URL(value).protocol === 'https:'; } catch { return false; } }
function describe(error: unknown): string { return error instanceof Error ? error.message : 'invalid JSON'; }
