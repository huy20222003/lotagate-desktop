import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const imageConfigPath = resolve(desktopRoot, 'resources', 'sandbox', 'wsl2-image-manifest.json');
const dependencyManifestPath = resolve(desktopRoot, 'resources', 'native-dependencies', 'manifest.json');
const options = parseOptions(process.argv.slice(2));

if (options.help) {
  console.log('Usage: node scripts/prepare-wsl2-image.mjs --arch x64|arm64 [--force]');
  process.exit(0);
}
if (process.platform !== 'win32') fail('The WSL2 image can only be prepared on a Windows build runner.');

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
await rm(buildDirectory, { recursive: true, force: true });
await mkdir(buildDirectory, { recursive: true });
await cleanupAbandonedBuildDistributions();
process.once('SIGINT', () => void cleanupAndExit(130));
process.once('SIGTERM', () => void cleanupAndExit(143));
try {
  await run('wsl.exe', ['--import', importedDistribution, installDirectory, sourcePath, '--version', '2'], 60 * 60 * 1_000);
  await runGuest(importedDistribution, ['--exec', 'apt-get', 'update'], 60 * 60 * 1_000);
  const aptPackages = await resolveAptPackages(importedDistribution, dependencies.apt);
  await runGuest(importedDistribution, ['--exec', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '--no-install-recommends', ...aptPackages], 60 * 60 * 1_000);
  for (const npm of dependencies.npm) await runGuest(importedDistribution, ['--exec', 'npm', 'install', '--prefix', npm.prefix, '--no-save', ...npm.packages], 60 * 60 * 1_000);
  await rm(outputPath, { force: true });
  await run('wsl.exe', ['--export', importedDistribution, outputPath], 60 * 60 * 1_000);
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
    const result = await run('wsl.exe', ['--list', '--quiet'], 15_000);
    return decodeWslOutput(result.stdout).split(/\r?\n/u).map(value => value.trim()).filter(Boolean);
  } catch (error) {
    fail(`Unable to query registered WSL2 distributions before image preparation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function unregisterDistribution(distribution) {
  await run('wsl.exe', ['--unregister', distribution], 10 * 60 * 1_000).catch(error => {
    console.warn(`Unable to unregister WSL2 distribution ${distribution}: ${error instanceof Error ? error.message : String(error)}`);
  });
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
  for (const packageName of packages) {
    const result = await runGuest(distribution, ['--exec', 'apt-cache', 'policy', packageName], 30_000);
    const candidate = /^\s*Candidate:\s*(\S+)\s*$/mu.exec(decodeWslOutput(result.stdout))?.[1];
    if (!candidate || candidate === '(none)') fail(`No apt candidate version is available for '${packageName}'.`);
    resolved.push(`${packageName}=${candidate}`);
  }
  return resolved;
}

async function downloadAndVerify(url, expectedSha256, target) {
  if (await pathExists(target) && await sha256(target) === expectedSha256) return;
  const response = await fetch(url);
  if (!response.ok || response.body === null) fail(`Unable to download the WSL2 rootfs: ${response.status} ${response.statusText}.`);
  const temporaryPath = `${target}.part`;
  await rm(temporaryPath, { force: true });
  await pipeline(response.body, createWriteStream(temporaryPath));
  const actualSha256 = await sha256(temporaryPath);
  if (actualSha256 !== expectedSha256) {
    await rm(temporaryPath, { force: true });
    fail(`WSL2 rootfs checksum mismatch. Expected ${expectedSha256}, received ${actualSha256}.`);
  }
  await rm(target, { force: true });
  const fs = await import('node:fs/promises');
  await fs.rename(temporaryPath, target);
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
  return execFileAsync(command, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' });
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

function isSafePackage(value) { return typeof value === 'string' && /^[A-Za-z0-9@+_.:/-]+$/u.test(value); }

function parseOptions(args) {
  const parsed = { arch: process.arch === 'arm64' ? 'arm64' : 'x64', force: false, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') parsed.help = true;
    else if (argument === '--force') parsed.force = true;
    else if (argument === '--arch') parsed.arch = args[++index];
    else fail(`Unknown option '${argument}'.`);
  }
  if (!['x64', 'arm64'].includes(parsed.arch)) fail(`Unsupported architecture '${parsed.arch}'.`);
  return parsed;
}

function fail(message) { console.error(message); process.exit(1); }
