import { createPortableDocumentBackend } from '../documents/portable-document-backend.js';

interface DocumentRequest {
  readonly cwd: string;
  readonly action: string;
  readonly path: string;
  readonly params: Record<string, unknown>;
  readonly officeBridgePath?: string;
}

const request = JSON.parse(await readStdin()) as DocumentRequest;
try {
  const backend = await createPortableDocumentBackend(request.officeBridgePath);
  const result = await backend.execute(request.cwd, { action: request.action, path: request.path, params: request.params });
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'The guest document backend failed.' }));
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    process.stdin.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.once('error', reject);
  });
}
