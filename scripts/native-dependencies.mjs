import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(desktopRoot, 'resources', 'native-dependencies', 'manifest.json');
const options = parseOptions(process.argv.slice(2));
const platform = options.platform ?? process.platform;

if (!['win32', 'darwin', 'linux'].includes(platform)) fail(`Unsupported platform '${platform}'.`);
if (options.install && platform !== process.platform) fail(`Installation must run on the target host. Current host is '${process.platform}', target is '${platform}'.`);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const dependencies = manifest.dependencies.filter(dependency => dependency.platforms.includes(platform));
const statuses = [];

for (const dependency of dependencies) statuses.push({ dependency, installed: await probe(dependency.probe) });

if (!options.install) {
  printReport(statuses, options.json);
  process.exit(statuses.some(item => !item.installed && item.dependency.install?.[platform] !== undefined) ? 2 : 0);
}

let installedCount = 0;
for (const item of statuses) {
  if (item.installed) continue;
  const definition = item.dependency.install?.[platform];
  if (definition === undefined) {
    console.log(`- ${item.dependency.label}: manual action required${item.dependency.manual ? ` — ${item.dependency.manual}` : ''}`);
    continue;
  }
  const installer = await findAvailableInstaller(definition);
  if (installer === undefined) fail(`No supported package manager is available for ${platform}. Install the official host package manager, then rerun this command.`);
  await install(installer);
  installedCount += 1;
}

console.log(`\nRequested ${installedCount} dependency installation(s). Run 'npm run native:check' again after installers finish.`);

function parseOptions(args) {
  const parsed = { install: false, json: false, platform: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--install') parsed.install = true;
    else if (argument === '--check') parsed.install = false;
    else if (argument === '--json') parsed.json = true;
    else if (argument === '--platform') {
      const value = args[++index];
      if (!value || value.startsWith('--')) fail('--platform requires a value.');
      parsed.platform = value;
    } else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/native-dependencies.mjs [--check] [--install] [--platform win32|darwin|linux] [--json]');
      process.exit(0);
    } else fail(`Unknown option '${argument}'.`);
  }
  return parsed;
}

async function probe(definition) {
  if (definition.type === 'manual') return false;
  if (definition.type === 'command') return commandAvailable(definition.command);
  if (definition.type === 'commandAny') return (await Promise.all(definition.commands.map(commandAvailable))).some(Boolean);
  if (definition.type === 'commandsAll') return (await Promise.all(definition.commands.map(commandAvailable))).every(Boolean);
  if (definition.type === 'commandGroups') return (await Promise.all(definition.groups.map(async group => (await Promise.all(group.map(commandAvailable))).some(Boolean)))).every(Boolean);
  if (definition.type === 'pythonImport') {
    for (const command of process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python']) {
      if (await commandWorks(command, ['-c', `import ${definition.module}`])) return true;
    }
  }
  return false;
}

async function commandAvailable(command) {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    await execFileAsync(lookup, [command], { windowsHide: true, timeout: 2_000, maxBuffer: 16 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function commandWorks(command, args) {
  try {
    await execFileAsync(command, args, { windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function install(definition) {
  const invocation = managerInvocation(definition);
  if (!(await commandAvailable(invocation.command))) fail(`Package manager '${invocation.command}' is not installed or is not available on PATH. Install it from its official source, then rerun this command.`);
  console.log(`\n==> Installing ${definition.packageId} with ${invocation.command}`);
  await execFileAsync(invocation.command, invocation.args, { windowsHide: true, timeout: 60 * 60 * 1_000, maxBuffer: 4 * 1024 * 1024 });
}

async function findAvailableInstaller(definition) {
  if (definition === undefined) return undefined;
  const candidates = Array.isArray(definition) ? definition : [definition];
  for (const candidate of candidates) if (await commandAvailable(packageManagerBinary(candidate.manager))) return candidate;
  return undefined;
}

function managerInvocation(definition) {
  if (definition.manager === 'winget') return { command: 'winget.exe', args: ['install', '--id', definition.packageId, '--exact', '--source', 'winget', '--silent', '--accept-source-agreements', '--accept-package-agreements'] };
  if (definition.manager === 'brew') return { command: 'brew', args: definition.cask ? ['install', '--cask', definition.packageId] : ['install', definition.packageId] };
  if (definition.manager === 'apt') return { command: 'sudo', args: ['apt-get', 'install', '-y', ...definition.packageId.split(/\s+/u)] };
  if (definition.manager === 'dnf') return { command: 'sudo', args: ['dnf', 'install', '-y', ...definition.packageId.split(/\s+/u)] };
  return { command: 'sudo', args: ['pacman', '-S', '--needed', '--noconfirm', ...definition.packageId.split(/\s+/u)] };
}

function packageManagerBinary(manager) {
  if (manager === 'winget') return 'winget.exe';
  if (manager === 'brew') return 'brew';
  if (manager === 'apt') return 'apt-get';
  if (manager === 'dnf') return 'dnf';
  return 'pacman';
}

function printReport(items, asJson) {
  const report = items.map(({ dependency, installed }) => ({ id: dependency.id, label: dependency.label, installed, installable: dependency.install?.[platform] !== undefined, ...(installed || dependency.manual === undefined ? {} : { reason: dependency.manual }) }));
  if (asJson) {
    console.log(JSON.stringify({ platform, dependencies: report }, null, 2));
    return;
  }
  console.log(`Native dependency status for ${platform}:`);
  for (const item of report) console.log(`- ${item.installed ? 'OK' : item.installable ? 'MISSING' : 'MANUAL'} ${item.label}${item.reason ? ` — ${item.reason}` : ''}`);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}
