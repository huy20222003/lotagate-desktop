import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { WHISPER_CPP_VERSION } from './speech-runtime-constants.mjs';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(desktopRoot, 'out', 'make');
const electronRoot = resolve(desktopRoot, 'node_modules', 'electron');
const cliRoot = resolve(desktopRoot, 'node_modules', '@lotagate', 'cli');
const minimumNodeMajor = 22;
const wixVersion = '3.14.1';
const wixDownloadUrl = 'https://github.com/wixtoolset/wix3/releases/download/wix314rtm/wix314-binaries.zip';
const wixArchiveSha256 = '13f067f38969faf163d93a804b48ea0576790a202c8f10291f2000f0e356e934';
const localWixRoot = resolve(desktopRoot, '.tools', 'wix', `v${wixVersion}`);

const platformPlans = {
  win32: {
    name: 'Windows',
    artifacts: ['WiX MSI', 'ZIP'],
    prerequisites: [
      ['candle.exe', 'WiX Toolset 3 (candle.exe)'],
      ['light.exe', 'WiX Toolset 3 (light.exe)'],
    ],
  },
  darwin: {
    name: 'macOS',
    artifacts: ['DMG', 'ZIP'],
    prerequisites: [['hdiutil', 'macOS hdiutil']],
  },
  linux: {
    name: 'Linux',
    artifacts: ['DEB', 'RPM'],
    prerequisites: [
      ['dpkg-deb', 'dpkg-deb'],
      ['rpmbuild', 'rpm-build'],
    ],
  },
};

const options = parseOptions(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const targetPlatform = options.platform ?? process.platform;
const plan = platformPlans[targetPlatform];
const targetId = `${targetPlatform}-${options.arch}`;

if (!plan) {
  fail(`Unsupported platform '${targetPlatform}'. Use win32, darwin, or linux.`);
}

if (targetPlatform !== process.platform) {
  fail(
    `Cross-platform packaging is not supported by this script. Run it on ${plan.name} ` +
      `to produce ${plan.artifacts.join(' and ')}.`,
  );
}

assertNodeVersion();
await assertProjectFiles();

if (options.dryRun) {
  printPlan(plan, options);
  process.exit(0);
}

if (!options.skipInstall && !(await hasNodeModules())) {
  await runNpm(['ci'], 'Installing locked dependencies');
}

if (!(await hasForgeBinary())) {
  fail(
    (options.skipInstall ? 'node_modules is missing or ' : '') +
      'electron-forge is not installed. Run npm ci (or npm install) in Desktop, then rerun this script. ' +
      'The script does not replace an existing node_modules directory so local CLI links remain intact.',
  );
}

await ensureElectronRuntime(targetPlatform, options.arch);
await ensureCliRuntime();
await assertNativePrerequisites(plan);

if (!options.skipValidation) {
  await runNpm(['run', 'typecheck'], 'Typechecking Desktop');
  await runNpm(['run', 'lint'], 'Linting Desktop');
  await runNpm(['run', 'check:file-size'], 'Checking source file sizes');
  await runNpm(['test'], 'Running Desktop tests');
}

const stagedCliPath = resolve(desktopRoot, '.tools', 'packaging', 'cli', targetId);
await runNpm(['run', 'cli:prepare', '--', '--platform', targetPlatform, '--arch', options.arch, '--output', stagedCliPath], 'Staging target-specific CLI runtime');
const stagedCliManifest = JSON.parse(await readFile(resolve(stagedCliPath, 'manifest.json'), 'utf8'));
if (typeof stagedCliManifest.binary !== 'string' || stagedCliManifest.binary.trim() === '') fail(`CLI staging manifest is missing the target binary name: ${resolve(stagedCliPath, 'manifest.json')}.`);
process.env['LOTAGATE_PACKAGED_CLI_PATH'] = resolve(stagedCliPath, stagedCliManifest.binary);
await rm(outputRoot, { recursive: true, force: true });
await runNpm(['run', 'build'], 'Building Desktop bundles');
process.env['LOTAGATE_BUILD_PLATFORM'] = targetPlatform;
process.env['LOTAGATE_BUILD_ARCH'] = options.arch;
await runNpm(
  ['run', 'make', '--', '--platform', targetPlatform, '--arch', options.arch],
  `Creating ${plan.name} installers`,
);
await printArtifacts(targetPlatform, options.arch);

function parseOptions(args) {
  const parsed = {
    arch: process.arch === 'arm64' ? 'arm64' : 'x64',
    dryRun: false,
    help: false,
    platform: undefined,
    skipInstall: false,
    skipValidation: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') parsed.help = true;
    else if (argument === '--dry-run') parsed.dryRun = true;
    else if (argument === '--skip-install') parsed.skipInstall = true;
    else if (argument === '--skip-validation') parsed.skipValidation = true;
    else if (argument === '--platform') parsed.platform = requireValue(args, ++index, argument);
    else if (argument === '--arch') parsed.arch = requireValue(args, ++index, argument);
    else fail(`Unknown option '${argument}'. Use --help to see supported options.`);
  }

  if (!['x64', 'arm64'].includes(parsed.arch)) fail(`Unsupported architecture '${parsed.arch}'. Use x64 or arm64.`);
  return parsed;
}

function requireValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith('--')) fail(`Option '${option}' requires a value.`);
  return value;
}

function assertNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  if (!Number.isInteger(major) || major < minimumNodeMajor) {
    fail(`Node.js ${minimumNodeMajor}+ is required; found ${process.versions.node}.`);
  }
}

async function assertProjectFiles() {
  for (const file of ['package.json', 'package-lock.json', 'forge.config.ts']) {
    try {
      await access(resolve(desktopRoot, file), constants.F_OK);
    } catch {
      fail(`Desktop file '${file}' was not found in ${desktopRoot}.`);
    }
  }
}

async function hasNodeModules() {
  try {
    await access(resolve(desktopRoot, 'node_modules'), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureElectronRuntime(platform, arch) {
  if (await electronRuntimeIsInstalled()) return;

  await runNodeScript(
    resolve(electronRoot, 'install.js'),
    'Downloading the Electron runtime',
    {
      ELECTRON_INSTALL_PLATFORM: platform,
      ELECTRON_INSTALL_ARCH: arch,
    },
  );

  if (!(await electronRuntimeIsInstalled())) {
    fail(`Electron runtime is not installed for ${platform}/${arch}.`);
  }
}

async function electronRuntimeIsInstalled() {
  try {
    const platformPath = (await readFile(resolve(electronRoot, 'path.txt'), 'utf8')).trim();
    return platformPath.length > 0 && (await fileExists(resolve(electronRoot, 'dist', platformPath)));
  } catch {
    return false;
  }
}

async function ensureCliRuntime() {
  await runNodeScript(
    resolve(cliRoot, 'scripts', 'install-native.mjs'),
    'Preparing the @lotagate/cli native runtime',
  );
}

async function hasForgeBinary() {
  const binary = process.platform === 'win32' ? 'electron-forge.cmd' : 'electron-forge';
  try {
    await access(resolve(desktopRoot, 'node_modules', '.bin', binary), constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertNativePrerequisites(plan) {
  if (process.platform === 'win32') await prepareWindowsWix();

  const missing = plan.prerequisites.filter(([command]) => !commandExists(command));
  if (missing.length > 0) {
    fail(
      `Cannot build ${plan.name} installers. Install: ${missing.map(([, packageName]) => packageName).join(', ')}.`,
    );
  }

  if (process.platform === 'darwin' && process.env['LOTAGATE_MAC_INSTALLER_IDENTITY']?.trim()) {
    if (!commandExists('security')) fail('macOS security CLI is required when LOTAGATE_MAC_INSTALLER_IDENTITY is set.');
    const identity = process.env['LOTAGATE_MAC_INSTALLER_IDENTITY'].trim();
    const result = spawnSync('security', ['find-identity', '-v', '-p', 'mac_installer'], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout.includes(identity)) {
      fail(`The configured macOS installer identity was not found: ${identity}.`);
    }
  }
}

async function prepareWindowsWix() {
  if (commandExists('candle.exe') && commandExists('light.exe')) return;

  const configuredWixRoot = process.env['LOTAGATE_WIX_HOME']?.trim();
  const candidateRoot = configuredWixRoot ? resolve(configuredWixRoot) : localWixRoot;
  const candlePath = resolve(candidateRoot, 'candle.exe');
  const lightPath = resolve(candidateRoot, 'light.exe');

  if (!(await fileExists(candlePath)) || !(await fileExists(lightPath))) {
    if (configuredWixRoot) {
      fail(`LOTAGATE_WIX_HOME does not contain candle.exe and light.exe: ${candidateRoot}.`);
    }
    await downloadAndExtractWix(candidateRoot);
  }

  process.env.Path = `${candidateRoot};${process.env.Path ?? ''}`;
}

async function downloadAndExtractWix(destination) {
  const archivePath = resolve(destination, `wix-${wixVersion}-binaries.zip`);
  await mkdir(destination, { recursive: true });

  console.log(`\n==> Preparing WiX Toolset ${wixVersion}`);
  console.log(`Downloading official WiX binaries to ${destination}`);
  await runPowerShell(
    `$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri ${quotePowerShell(wixDownloadUrl)} -OutFile ${quotePowerShell(archivePath)} -ErrorAction Stop`,
    'Downloading WiX binaries',
  );

  const archiveHash = createHash('sha256').update(await readFile(archivePath)).digest('hex');
  if (archiveHash !== wixArchiveSha256) {
    fail(`WiX archive SHA-256 mismatch. Expected ${wixArchiveSha256}, received ${archiveHash}.`);
  }

  await runPowerShell(
    `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(destination)} -Force`,
    'Extracting WiX binaries',
  );
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function runPowerShell(command, label) {
  return new Promise((resolvePromise, reject) => {
    console.log(`==> ${label}`);
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: desktopRoot,
      env: process.env,
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} failed with exit code ${String(code)}.`));
    });
  });
}

function commandExists(command) {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  return spawnSync(lookup, [command], { stdio: 'ignore' }).status === 0;
}

function runNodeScript(scriptPath, label, environment = {}) {
  return new Promise((resolvePromise, reject) => {
    console.log(`\n==> ${label}`);
    const child = spawn(process.execPath, [scriptPath], {
      cwd: desktopRoot,
      env: { ...process.env, ...environment },
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} failed with exit code ${String(code)}.`));
    });
  });
}

function runNpm(args, label) {
  return new Promise((resolvePromise, reject) => {
    console.log(`\n==> ${label}`);
    const npmExecPath = process.env.npm_execpath;
    const useNpmScript = typeof npmExecPath === 'string' && npmExecPath.trim() !== '';
    const command = useNpmScript ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const commandArgs = useNpmScript ? [npmExecPath, ...args] : args;
    const child = spawn(command, commandArgs, {
      cwd: desktopRoot,
      env: process.env,
      shell: command === 'npm.cmd',
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${label} failed with exit code ${String(code)}.`));
    });
  });
}

async function printArtifacts(platform, architecture) {
  let entries;
  try {
    entries = await readdir(outputRoot, { withFileTypes: true, recursive: true });
  } catch {
    fail(`Forge completed but the artifact directory was not found: ${outputRoot}.`);
  }

  const artifacts = entries
    .filter(entry => entry.isFile() && /\.(msi|zip|dmg|pkg|deb|rpm)$/i.test(entry.name))
    .map(entry => relative(outputRoot, resolve(entry.parentPath ?? outputRoot, entry.name)))
    .sort();
  if (artifacts.length === 0) fail(`Forge completed but no installer artifact was found under ${outputRoot}.`);

  const packageManifest = JSON.parse(await readFile(resolve(desktopRoot, 'package.json'), 'utf8'));
  const artifactDetails = await Promise.all(artifacts.map(async artifact => {
    const artifactPath = resolve(outputRoot, artifact);
    return { file: artifact, sizeBytes: (await stat(artifactPath)).size, sha256: createHash('sha256').update(await readFile(artifactPath)).digest('hex') };
  }));
  await writeFile(resolve(outputRoot, 'release-manifest.json'), `${JSON.stringify({ version: 1, product: 'lotagate-desktop', desktopVersion: packageManifest.version, target: { id: `${platform}-${architecture}`, platform, architecture }, artifacts: artifactDetails }, null, 2)}\n`, 'utf8');

  console.log('\nInstaller artifacts:');
  for (const artifact of artifactDetails) console.log(`- ${resolve(outputRoot, artifact.file)} (${artifact.sizeBytes} bytes, sha256 ${artifact.sha256})`);
}

function printPlan(plan, selectedOptions) {
  console.log(`Host: ${plan.name} (${process.arch})`);
  console.log(`Architecture: ${selectedOptions.arch}`);
  console.log(`Artifacts: ${plan.artifacts.join(', ')}`);
  console.log(`Speech runtime: whisper.cpp ${WHISPER_CPP_VERSION}; model is downloaded lazily on first use`);
  if (process.platform === 'darwin' && process.env['LOTAGATE_MAC_INSTALLER_IDENTITY']?.trim()) {
    console.log('macOS PKG: enabled by LOTAGATE_MAC_INSTALLER_IDENTITY');
  } else if (process.platform === 'darwin') {
    console.log('macOS PKG: disabled; DMG and ZIP will be built');
  }
  console.log(`Validation: ${selectedOptions.skipValidation ? 'skipped' : 'typecheck, lint, file-size, tests'}`);
  console.log(`Dependency install: ${selectedOptions.skipInstall ? 'skipped' : 'only when node_modules is missing'}`);
}

function printHelp() {
  console.log(`Usage: node scripts/build-installers.mjs [options]

Build the native Desktop installers for the current operating system.

Options:
  --platform <name>     Explicitly select win32, darwin, or linux (must match host)
  --arch <arch>         Build x64 or arm64 (defaults to the current Node architecture)
  --skip-install        Do not install dependencies when node_modules is missing
  --skip-validation     Skip typecheck, lint, file-size check, and tests
  --dry-run             Print the resolved build plan without changing files
  -h, --help            Show this help

Outputs are written under out/make. Run this script on a native runner for the
selected target. Windows requires WiX Toolset 3; Linux requires dpkg-deb and
rpmbuild. macOS PKG is enabled only when LOTAGATE_MAC_INSTALLER_IDENTITY is set.
`);
}

function fail(message) {
  console.error(`\nBuild stopped: ${message}`);
  process.exit(1);
}
