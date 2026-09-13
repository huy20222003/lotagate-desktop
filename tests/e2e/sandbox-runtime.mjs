import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const desktopRoot = resolve(import.meta.dirname, '../..');

if (process.platform !== 'win32') {
  console.log('WSL2 sandbox E2E is a Windows-only test.');
  process.exit(0);
}

const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
const imageRoot = resolve(desktopRoot, 'resources', 'sandbox', 'wsl2', architecture);
const imagePath = join(imageRoot, 'lotagate-guest.tar');
const metadataPath = `${imagePath}.json`;
const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
if (metadata.schemaVersion !== 2 || metadata.architecture !== architecture || typeof metadata.imageSha256 !== 'string') throw new Error('The packaged WSL2 image metadata is incomplete.');
await access(imagePath);
const checksum = await sha256(imagePath);
if (checksum !== metadata.imageSha256) throw new Error(`The packaged WSL2 image checksum is invalid. Expected ${metadata.imageSha256}, received ${checksum}.`);

const distribution = `LotaGate-E2E-${process.pid}`;
const stateDirectory = await mkdtemp(join(tmpdir(), 'lotagate-wsl2-e2e-'));
try {
  await run('wsl.exe', ['--import', distribution, stateDirectory, imagePath, '--version', '2']);
  await run('wsl.exe', ['--distribution', distribution, '--user', 'root', '--exec', 'bash', '-lc', [
    'set -eu',
    'command -v bwrap >/dev/null',
    'command -v python3 >/dev/null',
    'command -v soffice >/dev/null',
    'command -v pdfinfo >/dev/null',
    "printf '%s\\n' 'LotaGate document smoke test' > /tmp/lotagate-document-smoke.txt",
    "soffice --headless --convert-to pdf --outdir /tmp /tmp/lotagate-document-smoke.txt >/tmp/lotagate-soffice.log 2>&1",
    'test -s /tmp/lotagate-document-smoke.pdf',
    'pdfinfo /tmp/lotagate-document-smoke.pdf >/dev/null',
  ].join('; ')]);
  console.log(`WSL2 image import and document tool smoke test passed for ${architecture}.`);
} finally {
  await run('wsl.exe', ['--unregister', distribution]).catch(() => undefined);
  await rm(stateDirectory, { recursive: true, force: true });
}

async function run(command, args) {
  return execFileAsync(command, args, { windowsHide: true, timeout: 60 * 60 * 1_000, maxBuffer: 4 * 1024 * 1024 });
}

async function sha256(path) {
  const hash = createHash('sha256');
  const file = await import('node:fs');
  for await (const chunk of file.createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
