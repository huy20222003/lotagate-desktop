import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SpeechModelManager } from './speech-model-manager.js';

const model = Buffer.from('speech-model-test');
const sha256 = createHash('sha256').update(model).digest('hex');
const roots: string[] = [];

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('SpeechModelManager', () => {
  it('downloads, validates, caches, and reuses the model', async () => {
    const root = await createRoot();
    let requests = 0;
    const manager = new SpeechModelManager({ resourceRoot: root, cacheRoot: join(root, 'cache'), fetch: async () => { requests += 1; return new Response(model); } });
    await writeManifest(root);

    const [first, second] = await Promise.all([manager.ensureModel(), manager.ensureModel()]);

    expect(first).toBe(second);
    expect(await readFile(first)).toEqual(model);
    expect(requests).toBe(1);
  });

  it('rejects a response whose content does not match the manifest', async () => {
    const root = await createRoot();
    await writeManifest(root);
    const manager = new SpeechModelManager({ resourceRoot: root, cacheRoot: join(root, 'cache'), fetch: async () => new Response('wrong') });

    await expect(manager.ensureModel()).rejects.toThrow('failed integrity validation');
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lotagate-speech-model-'));
  roots.push(root);
  return root;
}

async function writeManifest(root: string): Promise<void> {
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ version: 1, model: { file: 'model.bin', url: 'https://example.test/model.bin', sha256, sizeBytes: model.byteLength } }));
}
