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
const guestRunnerPath = toWslPath(resolve(desktopRoot, 'resources', 'sandbox', 'guest-runner.py'));
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
    'command -v pip3 >/dev/null',
    'python3 -m pip --version >/dev/null',
    "! command -v chromium >/dev/null 2>&1",
    "! command -v chromium-browser >/dev/null 2>&1",
    "! command -v google-chrome >/dev/null 2>&1",
    "! python3 -m pip list --format=freeze | grep -i '^playwright==' >/dev/null 2>&1",
    "! command -v soffice >/dev/null 2>&1",
    "! command -v pdftk >/dev/null 2>&1",
  ].join('; ')]);
  await run('wsl.exe', ['--distribution', distribution, '--user', 'root', '--exec', 'python3', guestRunnerPath, '--prepare-python', '--venv', '/tmp/lotagate-document-python', '--package', 'pypdf==5.9.0:pypdf', '--package', 'reportlab==4.4.2:reportlab', '--package', 'python-pptx==1.0.2:pptx', '--package', 'openpyxl==3.1.5:openpyxl', '--package', 'python-docx==1.2.0:docx']);
  await run('wsl.exe', ['--distribution', distribution, '--user', 'root', '--exec', '/tmp/lotagate-document-python/bin/python', '-c', documentSmokeScript()]);
  console.log(`WSL2 image import and Python document-runtime smoke test passed for ${architecture}.`);
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

function toWslPath(path) {
  const match = /^([A-Za-z]):[\\/](.*)$/u.exec(path);
  if (match === null) throw new Error(`Cannot map Windows path to WSL2: ${path}`);
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\\\', '/').replaceAll('\\', '/')}`;
}

function documentSmokeScript() {
  return [
    'from pathlib import Path',
    'from docx import Document',
    'from openpyxl import Workbook, load_workbook',
    'from pptx import Presentation',
    'from pypdf import PdfReader',
    'from reportlab.pdfgen.canvas import Canvas',
    "root = Path('/tmp/lotagate-document-e2e'); root.mkdir(exist_ok=True)",
    "pdf = root / 'sample.pdf'; canvas = Canvas(str(pdf)); canvas.drawString(72, 720, 'document-e2e'); canvas.save(); assert len(PdfReader(str(pdf)).pages) == 1",
    "docx = root / 'sample.docx'; document = Document(); document.add_heading('document-e2e', level=1); document.save(docx); assert Document(docx).paragraphs[0].text == 'document-e2e'",
    "xlsx = root / 'sample.xlsx'; workbook = Workbook(); workbook.active['A1'] = 'document-e2e'; workbook.save(xlsx); assert load_workbook(xlsx, read_only=True).active['A1'].value == 'document-e2e'",
    "pptx = root / 'sample.pptx'; presentation = Presentation(); presentation.slides.add_slide(presentation.slide_layouts[6]); presentation.save(pptx); assert len(Presentation(pptx).slides) == 1",
  ].join('; ');
}
