import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WSL_IMAGE_OPERATION_TIMEOUT_MS = 60 * 60 * 1_000;
const WSL_DISTRIBUTION_QUERY_TIMEOUT_MS = 15_000;
const WSL_DISTRIBUTION_CLEANUP_TIMEOUT_MS = 10 * 60 * 1_000;
const WSL_IMAGE_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1_000;
const WSL_IMAGE_DOWNLOAD_MAX_ATTEMPTS = 3;
const WSL_IMAGE_DOWNLOAD_RETRY_DELAY_MS = 1_000;
const APT_RESOLUTION_TIMEOUT_MS = 30_000;
const COMMAND_OUTPUT_BYTES = 8 * 1024 * 1024;
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const imageConfigPath = resolve(desktopRoot, 'resources', 'sandbox', 'wsl2-image-manifest.json');
const dependencyManifestPath = resolve(desktopRoot, 'resources', 'native-dependencies', 'manifest.json');
const options = parseOptions(process.argv.slice(2));

if (options.help) {
  console.log('Usage: node scripts/prepare-wsl2-image.mjs --arch x64|arm64 [--force] [--container]');
  process.exit(0);
}
if (!options.container && process.platform !== 'win32') fail('The WSL2 image can only be prepared on a Windows build runner unless --container is used.');
if (options.container && process.platform !== 'linux') fail('The container WSL2 image builder must run on a Linux build runner.');

const imageConfig = JSON.parse(await readFile(imageConfigPath, 'utf8'));
const image = imageConfig.images?.[options.arch];
if (!isImageDefinition(image)) fail(`No WSL2 image definition exists for architecture ${options.arch}.`);
const outputDirectory = resolve(desktopRoot, 'resources', 'sandbox', 'wsl2', options.arch);
const outputPath = join(outputDirectory, image.outputFile);
const metadataPath = `${outputPath}.json`;
const cacheDirectory = resolve(desktopRoot, '.tools', 'wsl2-images');
const sourcePath = join(cacheDirectory, `${options.arch}-${image.outputFile}.gz`);
const buildDirectory = resolve(desktopRoot, '.tools', 'wsl2-image-build', `${options.arch}-${process.pid}`);
const importedDistribution = `${imageConfig.distribution}-build-${process.pid}`;
const installDirectory = join(buildDirectory, 'distribution');
let cleanupStarted = false;

const dependencies = await readGuestDependencies();
const dependencyManifestSha256 = await sha256(dependencyManifestPath);
if (!options.force && await reusableImage(metadataPath, outputPath, image, dependencyManifestSha256)) {
  console.log(`WSL2 image already prepared: ${outputPath}`);
  process.exit(0);
}

await mkdir(cacheDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });
await downloadAndVerify(image.sourceUrl, image.sourceSha256, sourcePath);
if (options.container) {
  await prepareWithContainer(sourcePath, outputPath, image, dependencies, dependencyManifestSha256);
  process.exit(0);
}
await rm(buildDirectory, { recursive: true, force: true });
await mkdir(buildDirectory, { recursive: true });
await cleanupAbandonedBuildDistributions();
process.once('SIGINT', () => void cleanupAndExit(130));
process.once('SIGTERM', () => void cleanupAndExit(143));
try {
  await run('wsl.exe', ['--import', importedDistribution, installDirectory, sourcePath, '--version', '2'], WSL_IMAGE_OPERATION_TIMEOUT_MS);
  await runGuest(importedDistribution, ['--exec', 'apt-get', 'update'], WSL_IMAGE_OPERATION_TIMEOUT_MS);
  const aptPackages = await resolveAptPackages(importedDistribution, dependencies.apt);
  await runGuest(importedDistribution, ['--exec', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '--no-install-recommends', ...aptPackages], WSL_IMAGE_OPERATION_TIMEOUT_MS);
  for (const npm of dependencies.npm) await runGuest(importedDistribution, ['--exec', 'npm', 'install', '--prefix', npm.prefix, '--no-save', ...npm.packages], WSL_IMAGE_OPERATION_TIMEOUT_MS);
  await rm(outputPath, { force: true });
  await run('wsl.exe', ['--export', importedDistribution, outputPath], WSL_IMAGE_OPERATION_TIMEOUT_MS);
  const checksum = await sha256(outputPath);
  await writeFile(`${outputPath}.sha256`, `${checksum}  ${image.outputFile}\n`, 'utf8');
  await writeFile(metadataPath, JSON.stringify({ schemaVersion: 2, architecture: options.arch, sourceSha256: image.sourceSha256, dependencyManifestSha256, aptPackages, imageSha256: checksum }, null, 2) + '\n', 'utf8');
  console.log(`Prepared WSL2 image ${outputPath} (${checksum}).`);
} finally {
  await unregisterDistribution(importedDistribution);
  await rm(buildDirectory, { recursive: true, force: true });
}

async function cleanupAbandonedBuildDistributions() {
  const distributions = await listDistributions();
  const prefix = `${imageConfig.distribution}-build-`;
  for (const distribution of distributions.filter(value => value.startsWith(prefix))) {
    const pid = Number(distribution.slice(prefix.length));
    if (!Number.isInteger(pid) || pid <= 0 || isProcessAlive(pid)) {
      fail(`A WSL2 image build is already active (${distribution}). Stop that build before starting another one.`);
    }
    console.warn(`Removing abandoned WSL2 build distribution ${distribution}.`);
    await unregisterDistribution(distribution);
  }
}

async function cleanupAndExit(code) {
  if (cleanupStarted) return;
  cleanupStarted = true;
  await unregisterDistribution(importedDistribution);
  await rm(buildDirectory, { recursive: true, force: true });
  process.exit(code);
}

async function listDistributions() {
  try {
    const result = await run('wsl.exe', ['--list', '--quiet'], WSL_DISTRIBUTION_QUERY_TIMEOUT_MS);
    return decodeWslOutput(result.stdout).split(/\r?\n/u).map(value => value.trim()).filter(Boolean);
  } catch (error) {
    fail(`Unable to query registered WSL2 distributions before image preparation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function unregisterDistribution(distribution) {
  await run('wsl.exe', ['--unregister', distribution], WSL_DISTRIBUTION_CLEANUP_TIMEOUT_MS).catch(error => {
    console.warn(`Unable to unregister WSL2 distribution ${distribution}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function prepareWithContainer(sourcePath, outputPath, image, dependencies, dependencyManifestSha256) {
  const imageTag = `lotagate-wsl2-builder:${options.arch}-${process.pid}`;
  const containerName = `lotagate-wsl2-builder-${options.arch}-${process.pid}`;
  const temporaryOutputPath = `${outputPath}.part`;
  try {
    await runDocker(['version', '--format', '{{.Server.Version}}'], WSL_IMAGE_OPERATION_TIMEOUT_MS);
    await runDocker(['import', '--platform', `linux/${options.arch === 'arm64' ? 'arm64' : 'amd64'}`, sourcePath, imageTag], WSL_IMAGE_OPERATION_TIMEOUT_MS);
    await runDocker(['run', '--name', containerName, imageTag, '/bin/sh', '-c', buildContainerInstallCommand(dependencies)], WSL_IMAGE_OPERATION_TIMEOUT_MS);
    await exportDockerContainer(containerName, temporaryOutputPath);
    await rm(outputPath, { force: true });
    await rename(temporaryOutputPath, outputPath);
    const checksum = await sha256(outputPath);
    await writeFile(`${outputPath}.sha256`, `${checksum}  ${image.outputFile}\n`, 'utf8');
    await writeFile(`${outputPath}.json`, JSON.stringify({ schemaVersion: 2, architecture: options.arch, sourceSha256: image.sourceSha256, dependencyManifestSha256, aptPackages: dependencies.apt, imageSha256: checksum }, null, 2) + '\n', 'utf8');
    console.log(`Prepared container-backed WSL2 image ${outputPath} (${checksum}).`);
  } finally {
    await rm(temporaryOutputPath, { force: true });
    await runDocker(['rm', '--force', containerName], WSL_IMAGE_OPERATION_TIMEOUT_MS).catch(() => undefined);
    await runDocker(['rmi', '--force', imageTag], WSL_IMAGE_OPERATION_TIMEOUT_MS).catch(() => undefined);
  }
}

function buildContainerInstallCommand(dependencies) {
  const packages = dependencies.apt.map(shellQuote).join(' ');
  const commands = [`apt-get update`, `DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ${packages}`, `rm -rf /var/lib/apt/lists/*`];
  for (const npm of dependencies.npm) commands.push(`npm install --prefix ${shellQuote(npm.prefix)} --no-save ${npm.packages.map(shellQuote).join(' ')}`);
  return commands.join(' && ');
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\\"'\\\"'")}'`;
}

async function exportDockerContainer(containerName, target) {
  const child = spawn('docker', ['export', containerName], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8').slice(-COMMAND_OUTPUT_BYTES); });
  const exit = new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolvePromise() : reject(new Error(`docker export failed with exit code ${String(code)}: ${stderr.trim()}`)));
  });
  try {
    await Promise.all([pipeline(child.stdout, createWriteStream(target)), exit]);
  } catch (error) {
    child.kill();
    await rm(target, { force: true });
    throw error;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function decodeWslOutput(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  const text = buffer.includes(0) ? buffer.toString('utf16le') : buffer.toString('utf8');
  return text.replace(/^\uFEFF/u, '').replaceAll('\u0000', '');
}

async function readGuestDependencies() {
  const manifest = JSON.parse(await readFile(dependencyManifestPath, 'utf8'));
  const guest = manifest.dependencies.filter(dependency => dependency.target === 'guest' && dependency.guest?.runtime === 'wsl2');
  const apt = [...new Set(guest.flatMap(dependency => dependency.guest?.packages?.apt ?? []))];
  const npm = guest.flatMap(dependency => dependency.guest?.npm === undefined ? [] : [dependency.guest.npm]);
  if (apt.some(value => !isSafePackage(value)) || npm.some(value => value.packages.some(packageName => !isSafePackage(packageName)))) fail('The native dependency manifest contains an unsafe guest package name.');
  return { apt, npm };
}

async function resolveAptPackages(distribution, packages) {
  const resolved = [];
  for (const packageSpec of packages) {
    const { name, version } = parseAptPackage(packageSpec);
    const result = await runGuest(distribution, ['--exec', 'apt-cache', 'policy', name], APT_RESOLUTION_TIMEOUT_MS);
    const policy = decodeWslOutput(result.stdout);
    if (version !== undefined) {
      if (!new RegExp(`^\\s*${escapeRegExp(version)}\\s`, 'mu').test(policy) && !new RegExp(`\\b${escapeRegExp(version)}\\b`, 'u').test(policy)) fail(`Pinned apt version '${packageSpec}' is not available in the WSL2 image sources.`);
      resolved.push(packageSpec);
      continue;
    }
    const candidate = /^\s*Candidate:\s*(\S+)\s*$/mu.exec(policy)?.[1];
    if (!candidate || candidate === '(none)') fail(`No apt candidate version is available for '${packageSpec}'.`);
    resolved.push(`${name}=${candidate}`);
  }
  return resolved;
}

async function downloadAndVerify(url, expectedSha256, target) {
  if (await pathExists(target) && await sha256(target) === expectedSha256) return;
  const temporaryPath = `${target}.part`;
  for (let attempt = 1; attempt <= WSL_IMAGE_DOWNLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      await rm(temporaryPath, { force: true });
      await pipeline(response.body, createWriteStream(temporaryPath));
      const actualSha256 = await sha256(temporaryPath);
      if (actualSha256 !== expectedSha256) throw new Error(`checksum mismatch (expected ${expectedSha256}, received ${actualSha256})`);
      await rm(target, { force: true });
      const fs = await import('node:fs/promises');
      await fs.rename(temporaryPath, target);
      return;
    } catch (error) {
      await rm(temporaryPath, { force: true });
      const reason = error instanceof Error ? error.message : String(error);
      if (attempt >= WSL_IMAGE_DOWNLOAD_MAX_ATTEMPTS) fail(`Unable to prepare the WSL2 rootfs after ${String(attempt)} attempts: ${reason}.`);
      console.warn(`WSL2 rootfs download attempt ${String(attempt)} failed: ${reason}. Retrying.`);
      await new Promise(resolve => setTimeout(resolve, WSL_IMAGE_DOWNLOAD_RETRY_DELAY_MS * attempt));
    }
  }
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WSL_IMAGE_DOWNLOAD_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`download timed out after ${String(WSL_IMAGE_DOWNLOAD_TIMEOUT_MS)}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function reusableImage(metadataPath, outputPath, image, dependencyManifestSha256) {
  if (!await pathExists(outputPath) || !await pathExists(metadataPath)) return false;
  try {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    return metadata.schemaVersion === 2 && metadata.architecture === options.arch && metadata.sourceSha256 === image.sourceSha256 && metadata.dependencyManifestSha256 === dependencyManifestSha256 && Array.isArray(metadata.aptPackages) && metadata.aptPackages.length > 0 && metadata.imageSha256 === await sha256(outputPath);
  } catch {
    return false;
  }
}

async function runGuest(distribution, args, timeoutMs) {
  return run('wsl.exe', ['--distribution', distribution, '--user', 'root', ...args], timeoutMs);
}

async function run(command, args, timeoutMs) {
  return execFileAsync(command, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: COMMAND_OUTPUT_BYTES, encoding: 'buffer' });
}

async function runDocker(args, timeoutMs) {
  return run('docker', args, timeoutMs);
}

async function sha256(path) {
  const file = await import('node:fs');
  const hash = createHash('sha256');
  const stream = file.createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function pathExists(path) {
  try { await access(path); return true; } catch { return false; }
}

function isImageDefinition(value) {
  return typeof value?.sourceUrl === 'string' && /^https:\/\//u.test(value.sourceUrl) && typeof value.sourceSha256 === 'string' && /^[a-f0-9]{64}$/u.test(value.sourceSha256) && typeof value.outputFile === 'string';
}

function isSafePackage(value) { return typeof value === 'string' && /^[A-Za-z0-9@+_.:=/-]+$/u.test(value); }

function parseAptPackage(value) {
  const match = /^([A-Za-z0-9][A-Za-z0-9+_.:@/-]*)(?:=(.+))?$/u.exec(value);
  if (!match) fail(`The native dependency manifest contains an invalid apt package '${value}'.`);
  return { name: match[1], version: match[2] };
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }

function parseOptions(args) {
  const parsed = { arch: process.arch === 'arm64' ? 'arm64' : 'x64', container: false, force: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') parsed.help = true;
    else if (argument === '--container') parsed.container = true;
    else if (argument === '--force') parsed.force = true;
    else if (argument === '--arch') parsed.arch = args[++index];
    else fail(`Unknown option '${argument}'.`);
  }
  if (!['x64', 'arm64'].includes(parsed.arch)) fail(`Unsupported architecture '${parsed.arch}'.`);
  return parsed;
}

function fail(message) { console.error(message); process.exit(1); }
