import { createHash } from 'node:crypto';
import { access, chmod, copyFile, mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resourceRoot = resolve(desktopRoot, 'resources', 'speech');
const releaseVersion = 'v1.9.1';
const modelName = 'ggml-small-q5_1.bin';
const defaultModelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelName}?download=true`;
const modelSha256 = 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb';
const modelSizeBytes = 190_085_487;
const modelUrl = process.env['LOTAGATE_SPEECH_MODEL_URL']?.trim() || defaultModelUrl;

const runtimeAssets = {
  'win32-x64': { archive: 'zip', file: 'whisper-bin-x64.zip', url: `https://github.com/ggml-org/whisper.cpp/releases/download/${releaseVersion}/whisper-bin-x64.zip`, sha256: '7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539' },
  'win32-arm64': { archive: 'zip', file: 'whisper-bin-x64.zip', url: `https://github.com/ggml-org/whisper.cpp/releases/download/${releaseVersion}/whisper-bin-x64.zip`, sha256: '7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539', compatibility: 'The x64 runtime runs through Windows ARM64 emulation.' },
  'linux-x64': { archive: 'tar.gz', file: 'whisper-bin-ubuntu-x64.tar.gz', url: `https://github.com/ggml-org/whisper.cpp/releases/download/${releaseVersion}/whisper-bin-ubuntu-x64.tar.gz`, sha256: undefined },
  'linux-arm64': { archive: 'tar.gz', file: 'whisper-bin-ubuntu-arm64.tar.gz', url: `https://github.com/ggml-org/whisper.cpp/releases/download/${releaseVersion}/whisper-bin-ubuntu-arm64.tar.gz`, sha256: 'e0b66cd551ff6f2a28fabe3c6e89691eea037bb76833493abb9a71ca788994b3' },
};

const options = parseOptions(process.argv.slice(2));
const targetKey = `${options.platform}-${options.arch}`;
const asset = runtimeAssets[targetKey];
const customExecutable = process.env['LOTAGATE_WHISPER_CPP_EXECUTABLE']?.trim();
if (asset === undefined && (options.platform !== 'darwin' || customExecutable === undefined || customExecutable.length === 0)) fail(`whisper.cpp ${releaseVersion} does not publish a packaged CLI for ${targetKey}. Build a native whisper-cli binary and set LOTAGATE_WHISPER_CPP_EXECUTABLE before preparing this target.`);

const runtimeRoot = resolve(resourceRoot, 'runtime', targetKey);
const temporaryRoot = await mkdtemp(join(desktopRoot, '.tools', 'speech-'));
try {
  if (asset === undefined) await prepareCustomRuntime(runtimeRoot, customExecutable, targetKey);
  else await prepareRuntime(runtimeRoot, asset, temporaryRoot, targetKey);
  await writeManifest(targetKey, asset);
  console.log(`Prepared whisper.cpp ${releaseVersion} for ${targetKey}.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function parseOptions(args) {
  const options = { platform: process.platform, arch: process.arch === 'arm64' ? 'arm64' : 'x64' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--platform') options.platform = requireValue(args, ++index, argument);
    else if (argument === '--arch') options.arch = requireValue(args, ++index, argument);
    else if (argument === '--help' || argument === '-h') { printHelp(); process.exit(0); }
    else fail(`Unknown option '${argument}'. Use --help to see supported options.`);
  }
  if (!['win32', 'darwin', 'linux'].includes(options.platform)) fail(`Unsupported platform '${options.platform}'.`);
  if (!['x64', 'arm64'].includes(options.arch)) fail(`Unsupported architecture '${options.arch}'.`);
  return options;
}

function requireValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith('--')) fail(`Option '${option}' requires a value.`);
  return value;
}

async function prepareRuntime(destination, asset, temporaryRoot, targetKey) {
  const executable = join(destination, executableName(targetKey));
  if (await fileExists(executable) && await fileExists(join(destination, 'runtime-manifest.json'))) return;
  const archivePath = join(temporaryRoot, asset.file);
  await download(asset.url, archivePath, `whisper.cpp ${releaseVersion} runtime for ${targetKey}`);
  if (asset.sha256 === undefined) console.warn(`No upstream SHA-256 manifest is published for ${asset.file}; the build is pinned to the exact ${releaseVersion} HTTPS asset.`);
  else await assertHash(archivePath, asset.sha256, `whisper.cpp ${asset.file}`);
  const extracted = join(temporaryRoot, 'extracted');
  await extractArchive(archivePath, asset.archive, extracted);
  const sourceExecutable = await findFile(extracted, executableName(targetKey));
  if (sourceExecutable === undefined) fail(`The whisper.cpp archive ${asset.file} does not contain whisper-cli.`);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const sourceDirectory = dirname(sourceExecutable);
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const source = join(sourceDirectory, entry.name);
    if (entry.name !== executableName(targetKey) && !isRuntimeLibrary(entry.name, targetKey)) continue;
    const destinationPath = join(destination, entry.name);
    await copyEntry(source, destinationPath, entry);
    if (entry.name === executableName(targetKey)) await chmod(destinationPath, 0o755);
  }
  await writeFile(join(destination, 'runtime-manifest.json'), JSON.stringify({ release: releaseVersion, target: targetKey, executable: executableName(targetKey), archive: asset.file, archiveSha256: asset.sha256 ?? null, ...(asset.compatibility === undefined ? {} : { compatibility: asset.compatibility }) }, null, 2).concat('\n'), 'utf8');
}

async function prepareCustomRuntime(destination, executable, targetKey) {
  const source = resolve(executable);
  if (!(await fileExists(source))) fail(`LOTAGATE_WHISPER_CPP_EXECUTABLE was not found: ${source}.`);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const destinationPath = join(destination, executableName(targetKey));
  await copyFile(source, destinationPath);
  await chmod(destinationPath, 0o755);
  await writeFile(join(destination, 'runtime-manifest.json'), JSON.stringify({ release: 'custom', target: targetKey, executable: executableName(targetKey), source: executableName(targetKey) }, null, 2).concat('\n'), 'utf8');
}

function isRuntimeLibrary(name, targetKey) {
  return targetKey.startsWith('win32-') ? extname(name).toLowerCase() === '.dll' : name.startsWith('lib') && name.includes('.so');
}

async function extractArchive(archivePath, archiveType, destination) {
  await mkdir(destination, { recursive: true });
  if (archiveType === 'zip') {
    await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(destination)} -Force`], 'Extracting whisper.cpp ZIP');
    return;
  }
  await run('tar', ['-xzf', archivePath, '-C', destination], 'Extracting whisper.cpp tarball');
}

async function download(url, destination, label) {
  if (await fileExists(destination)) return;
  console.log(`==> Downloading ${label}`);
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'LotaGate-Desktop-Build' } });
  if (!response.ok) fail(`Unable to download ${label}: HTTP ${response.status}.`);
  await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
}

async function assertHash(filePath, expected, label) {
  const received = createHash('sha256').update(await readFile(filePath)).digest('hex');
  if (received !== expected) fail(`${label} SHA-256 mismatch. Expected ${expected}, received ${received}.`);
}

async function findFile(directory, name) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { const result = await findFile(path, name); if (result !== undefined) return result; }
    else if (entry.name === name) return path;
  }
  return undefined;
}

async function copyEntry(source, destination, entry) {
  if (entry.isSymbolicLink()) await symlink(await readlink(source), destination);
  else await copyFile(source, destination);
}

async function writeManifest(targetKey, asset) {
  const manifestPath = resolve(resourceRoot, 'manifest.json');
  const current = await readJson(manifestPath);
  const runtimes = typeof current?.runtimes === 'object' && current.runtimes !== null ? current.runtimes : {};
  runtimes[targetKey] = asset === undefined ? { release: 'custom', executable: executableName(targetKey) } : { release: releaseVersion, executable: executableName(targetKey), archive: asset.file, archiveSha256: asset.sha256 ?? null, ...(asset.compatibility === undefined ? {} : { compatibility: asset.compatibility }) };
  await writeFile(manifestPath, JSON.stringify({ version: 1, model: { file: modelName, url: modelUrl, sha256: modelSha256, sizeBytes: modelSizeBytes }, runtimes }, null, 2).concat('\n'), 'utf8');
}

async function readJson(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return undefined; } }
async function fileExists(path) { try { await access(path, constants.F_OK); return true; } catch { return false; } }
function quotePowerShell(value) { return `'${value.replaceAll("'", "''")}'`; }
function executableName(targetKey) { return targetKey.startsWith('win32-') ? 'whisper-cli.exe' : 'whisper-cli'; }
function run(command, args, label) { return new Promise((resolvePromise, reject) => { const child = spawn(command, args, { cwd: desktopRoot, stdio: 'inherit', windowsHide: true }); child.once('error', reject); child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`${label} failed with exit code ${String(code)}.`))); }); }
function printHelp() { console.log('Usage: node scripts/prepare-speech-runtime.mjs [--platform win32|darwin|linux] [--arch x64|arm64]'); }
function fail(message) { console.error(`\nSpeech runtime preparation stopped: ${message}`); process.exit(1); }
