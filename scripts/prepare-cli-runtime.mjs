import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetPackages = {
  'win32-x64': { packageName: '@lotagate/cli-native-windows-x64', nativeTarget: 'windows-x64' },
  'win32-arm64': { packageName: '@lotagate/cli-native-windows-arm64', nativeTarget: 'windows-arm64' },
  'darwin-x64': { packageName: '@lotagate/cli-native-macos-x64', nativeTarget: 'macos-x64' },
  'darwin-arm64': { packageName: '@lotagate/cli-native-macos-arm64', nativeTarget: 'macos-arm64' },
  'linux-x64': { packageName: '@lotagate/cli-native-linux-x64-gnu', nativeTarget: 'linux-x64-gnu' },
  'linux-arm64': { packageName: '@lotagate/cli-native-linux-arm64-gnu', nativeTarget: 'linux-arm64-gnu' },
};

const options = parseOptions(process.argv.slice(2));
const targetId = `${options.platform}-${options.architecture}`;
const nativeTarget = targetPackages[targetId];
if (nativeTarget === undefined) throw new Error(`Unsupported CLI target: ${targetId}.`);
if (options.platform !== process.platform) throw new Error(`CLI staging must run on a native ${options.platform} runner; current host is ${process.platform}.`);

const cliRoot = resolve(desktopRoot, 'node_modules', '@lotagate', 'cli');
const cliManifest = await readJson(join(cliRoot, 'package.json'));
if (cliManifest?.name !== '@lotagate/cli' || typeof cliManifest.version !== 'string') {
  throw new Error('The installed @lotagate/cli package is missing or invalid.');
}

const cliTargets = await import(pathToFileURL(join(cliRoot, 'native-targets.mjs')).href);
const cliNativeTarget = cliTargets.targetById(nativeTarget.nativeTarget);
if (cliNativeTarget === undefined || typeof cliNativeTarget.binaryName !== 'string') {
  throw new Error(`The installed @lotagate/cli package does not define native target ${nativeTarget.nativeTarget}.`);
}

const nativeRoot = await findNativePackage(nativeTarget.packageName, cliRoot);
const nativeManifest = nativeRoot === undefined ? undefined : await readJson(join(nativeRoot, 'package.json'));
const source = nativeRoot === undefined ? undefined : join(nativeRoot, 'bin', cliNativeTarget.binaryName);
if (nativeManifest?.name !== nativeTarget.packageName || nativeManifest.version !== cliManifest.version || nativeManifest.lotagateNative?.target !== nativeTarget.nativeTarget || typeof nativeManifest.lotagateNative?.sha256 !== 'string' || source === undefined || !(await isFile(source))) {
  throw new Error(`The target-specific native CLI package ${nativeTarget.packageName} is not installed or failed integrity metadata validation. Run npm ci on the native ${targetId} runner.`);
}

const outputRoot = resolve(options.output ?? join(desktopRoot, '.tools', 'packaging', 'cli', targetId));
assertInsideDesktop(outputRoot);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const destination = join(outputRoot, cliNativeTarget.binaryName);
await copyFile(source, destination);
const sha256 = await hash(destination);
if (sha256 !== nativeManifest.lotagateNative.sha256) throw new Error(`The staged CLI checksum does not match ${nativeTarget.packageName}.`);
await writeFile(join(outputRoot, 'manifest.json'), `${JSON.stringify({ version: 1, target: targetId, package: '@lotagate/cli', cliVersion: cliManifest.version, nativePackage: nativeTarget.packageName, nativeTarget: nativeTarget.nativeTarget, binary: cliNativeTarget.binaryName, sha256 }, null, 2)}\n`, 'utf8');
console.log(`Staged ${nativeTarget.packageName}@${cliManifest.version} for ${targetId}: ${destination}`);

function parseOptions(args) {
  const parsed = { platform: process.platform, architecture: process.arch === 'arm64' ? 'arm64' : 'x64', output: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--platform') parsed.platform = requiredValue(args, ++index, argument);
    else if (argument === '--arch') parsed.architecture = requiredValue(args, ++index, argument);
    else if (argument === '--output') parsed.output = requiredValue(args, ++index, argument);
    else if (argument === '--help' || argument === '-h') { console.log('Usage: node scripts/prepare-cli-runtime.mjs [--platform win32|darwin|linux] [--arch x64|arm64] [--output path]'); process.exit(0); }
    else throw new Error(`Unknown option '${argument}'.`);
  }
  if (!['win32', 'darwin', 'linux'].includes(parsed.platform)) throw new Error(`Unsupported platform '${parsed.platform}'.`);
  if (!['x64', 'arm64'].includes(parsed.architecture)) throw new Error(`Unsupported architecture '${parsed.architecture}'.`);
  return parsed;
}

function requiredValue(args, index, option) {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) throw new Error(`Option '${option}' requires a value.`);
  return value;
}

async function findNativePackage(packageName, cliRootPath) {
  const segments = packageName.split('/');
  const candidates = [join(cliRootPath, 'node_modules', ...segments), join(desktopRoot, 'node_modules', ...segments)];
  for (const candidate of candidates) if (await isFile(join(candidate, 'package.json'))) return candidate;
  return undefined;
}

async function readJson(filePath) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch { return undefined; }
}

async function isFile(filePath) {
  try { return (await stat(filePath)).isFile(); } catch { return false; }
}

async function hash(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

function assertInsideDesktop(path) {
  const root = `${desktopRoot}${process.platform === 'win32' ? '\\' : '/'}`;
  if (path !== desktopRoot && !path.startsWith(root)) throw new Error(`Refusing to stage the CLI outside the Desktop workspace: ${path}.`);
}
