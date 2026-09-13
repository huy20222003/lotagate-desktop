import { access, mkdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { commandAvailable, commandWorks } from '../process/command-availability.js';
import { runBoundedCommand } from '../process/bounded-command.js';
import type { VmEnvironmentProfile } from '../sandbox/vm-types.js';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);

type SupportedPlatform = 'win32' | 'darwin' | 'linux';
type DependencyProbe =
  | { readonly type: 'command'; readonly command: string }
  | { readonly type: 'commandAny'; readonly commands: readonly string[] }
  | { readonly type: 'commandsAll'; readonly commands: readonly string[] }
  | { readonly type: 'commandGroups'; readonly groups: readonly (readonly string[])[] }
  | { readonly type: 'pythonImport'; readonly module: string }
  | { readonly type: 'manual' };
type PackageInstall = { readonly manager: 'winget' | 'brew' | 'apt' | 'dnf' | 'pacman'; readonly packageId: string; readonly cask?: boolean };
type PackageInstallDefinition = PackageInstall | readonly PackageInstall[];
type GuestDependency = {
  readonly runtime: 'wsl2';
  readonly profiles: readonly VmEnvironmentProfile[];
  readonly packages?: { readonly apt?: readonly string[] };
  readonly npm?: { readonly prefix: string; readonly packages: readonly string[] };
};
interface DependencyDefinition {
  readonly id: string;
  readonly label: string;
  readonly target?: 'host' | 'guest';
  /** Host dependencies used by the packaged startup bootstrap only when true. */
  readonly automaticInstall?: boolean;
  readonly platforms: readonly SupportedPlatform[];
  readonly probe: DependencyProbe;
  readonly install?: Partial<Record<SupportedPlatform, PackageInstallDefinition>>;
  readonly manual?: string;
  readonly note?: string;
  readonly guest?: GuestDependency;
}
interface DependencyManifest { readonly schemaVersion: number; readonly dependencies: readonly DependencyDefinition[] }

export interface NativeDependencyStatus {
  readonly id: string;
  readonly label: string;
  readonly installed: boolean;
  readonly installable: boolean;
  readonly reason?: string;
}

export interface NativeDependencyReport {
  readonly platform: SupportedPlatform;
  readonly statuses: readonly NativeDependencyStatus[];
  readonly installed: readonly string[];
  readonly missing: readonly string[];
  readonly manual: readonly string[];
  readonly failed: readonly string[];
  readonly restartRequired: boolean;
}

export interface NativeDependencyServiceOptions {
  readonly manifestPath: string;
  readonly guestImagePath?: string;
  readonly guestDataDirectory?: string;
  readonly log: (message: string, fields?: Record<string, unknown>) => void;
}

export interface GuestDependencyQuery {
  readonly runtime: 'auto' | 'wsl2' | 'disabled';
  readonly distribution: string;
  readonly profile: VmEnvironmentProfile;
}

export interface GuestDependencyOptions extends GuestDependencyQuery {
  readonly automatic: boolean;
}

export interface GuestDependencyReport {
  readonly runtime: 'wsl2' | 'bubblewrap' | 'seatbelt';
  readonly distribution: string;
  readonly profile: VmEnvironmentProfile;
  readonly available: boolean;
  readonly statuses: readonly NativeDependencyStatus[];
  readonly installed: readonly string[];
  readonly missing: readonly string[];
  readonly manual: readonly string[];
  readonly failed: readonly string[];
}

/**
 * Owns the one manifest-driven dependency flow used by packaged Desktop and
 * the developer installer script. Package managers are invoked without a
 * shell, and missing optional/manual prerequisites never block the app.
 */
export class NativeDependencyService {
  private readonly options: NativeDependencyServiceOptions;
  private readonly guestInstallOperations = new Map<string, Promise<GuestDependencyReport>>();

  public constructor(options: NativeDependencyServiceOptions) {
    this.options = options;
  }

  public async ensureInstalled(automatic: boolean): Promise<NativeDependencyReport> {
    const manifest = await readManifest(this.options.manifestPath);
    const platform = currentPlatform();
    const definitions = manifest.dependencies.filter(dependency => isHostDependency(dependency, platform) && (!automatic || dependency.automaticInstall !== false));
    const initial = await this.inspect(definitions, platform);
    if (!automatic || initial.missing.length === 0) return initial;

    const failed: string[] = [];
    let installedSomething = false;
    for (const dependency of definitions) {
      const status = initial.statuses.find(item => item.id === dependency.id);
      const installer = await findAvailableInstaller(dependency.install?.[platform]);
      if (status?.installed || installer === undefined) continue;
      try {
        await installWithPackageManager(installer);
        installedSomething = true;
        this.options.log('native-dependency.installed', { id: dependency.id, manager: installer.manager });
      } catch (error) {
        failed.push(dependency.id);
        this.options.log('native-dependency.install.failed', { id: dependency.id, message: error instanceof Error ? error.message : 'Dependency installation failed.' });
      }
    }

    const after = await this.inspect(definitions, platform);
    return {
      ...after,
      failed,
      restartRequired: installedSomething && after.missing.length < initial.missing.length,
    };
  }

  public async inspectCurrent(): Promise<NativeDependencyReport> {
    const manifest = await readManifest(this.options.manifestPath);
    const platform = currentPlatform();
    return this.inspect(manifest.dependencies.filter(dependency => isHostDependency(dependency, platform)), platform);
  }

  public async ensureGuestInstalled(options: GuestDependencyOptions): Promise<GuestDependencyReport> {
    const key = guestDependencyKey(options);
    const existing = this.guestInstallOperations.get(key);
    if (existing !== undefined) return existing;
    const operation = this.ensureGuestInstalledExclusive(options);
    this.guestInstallOperations.set(key, operation);
    void operation.then(
      () => this.releaseGuestInstall(key, operation),
      () => this.releaseGuestInstall(key, operation),
    );
    return operation;
  }

  private async ensureGuestInstalledExclusive(options: GuestDependencyOptions): Promise<GuestDependencyReport> {
    let initial = await this.inspectGuest(options);
    if (!initial.available && options.automatic && this.options.guestImagePath !== undefined) {
      try {
        await ensureGuestDistribution(options.distribution, this.options.guestImagePath, this.options.guestDataDirectory);
        initial = await this.inspectGuest(options);
        this.options.log('sandbox-runtime.guest.imported', { distribution: options.distribution, imagePath: this.options.guestImagePath });
      } catch (error) {
        this.options.log('sandbox-runtime.guest.import.failed', { distribution: options.distribution, message: error instanceof Error ? error.message : 'The packaged WSL2 image could not be imported.' });
        return { ...initial, failed: ['sandbox.wsl2.runtime'] };
      }
    }
    if (!options.automatic || initial.missing.length === 0 || !initial.available) return initial;
    const manifest = await readManifest(this.options.manifestPath);
    const definitions = manifest.dependencies.filter(dependency => isGuestDependency(dependency, options.profile));
    const failed = new Set<string>();
    const aptPackages = unique(definitions.flatMap(dependency => dependency.guest?.packages?.apt ?? []));
    if (aptPackages.length > 0) {
      try {
        await runGuestCommand(options.distribution, ['apt-get', 'update'], 60 * 60 * 1_000);
        const pinnedAptPackages = await resolveGuestAptPackages(options.distribution, aptPackages);
        await runGuestCommand(options.distribution, ['apt-get', 'install', '-y', '--no-install-recommends', ...pinnedAptPackages], 60 * 60 * 1_000);
        this.options.log('sandbox-dependency.guest.installed', { distribution: options.distribution, profile: options.profile, manager: 'apt', packages: aptPackages });
      } catch (error) {
        for (const dependency of definitions) if ((dependency.guest?.packages?.apt?.length ?? 0) > 0) failed.add(dependency.id);
        this.options.log('sandbox-dependency.guest.install.failed', { distribution: options.distribution, profile: options.profile, manager: 'apt', message: error instanceof Error ? error.message : 'Guest apt installation failed.' });
      }
    }
    const npmDefinitions = definitions.filter(dependency => dependency.guest?.npm !== undefined);
    for (const dependency of npmDefinitions) {
      const npm = dependency.guest?.npm;
      if (npm === undefined) continue;
      try {
        await runGuestCommand(options.distribution, ['npm', 'install', '--prefix', npm.prefix, '--no-save', ...npm.packages], 60 * 60 * 1_000);
        this.options.log('sandbox-dependency.guest.installed', { distribution: options.distribution, profile: options.profile, manager: 'npm', packages: npm.packages, dependency: dependency.id });
      } catch (error) {
        failed.add(dependency.id);
        this.options.log('sandbox-dependency.guest.install.failed', { distribution: options.distribution, profile: options.profile, manager: 'npm', dependency: dependency.id, message: error instanceof Error ? error.message : 'Guest npm installation failed.' });
      }
    }
    const after = await this.inspectGuest(options);
    return { ...after, failed: [...failed] };
  }

  private releaseGuestInstall(key: string, operation: Promise<GuestDependencyReport>): void {
    if (this.guestInstallOperations.get(key) === operation) this.guestInstallOperations.delete(key);
  }

  public async inspectGuest(options: GuestDependencyQuery): Promise<GuestDependencyReport> {
    if (options.runtime === 'disabled') return disabledGuestReport(options);
    if (process.platform !== 'win32') return this.inspectLocalGuest(options);
    const manifest = await readManifest(this.options.manifestPath);
    const definitions = manifest.dependencies.filter(dependency => isGuestDependency(dependency, options.profile));
    return inspectGuest(definitions, options.distribution, options.profile);
  }

  private async inspectLocalGuest(options: GuestDependencyQuery): Promise<GuestDependencyReport> {
    const runtime = process.platform === 'darwin' ? 'seatbelt' : 'bubblewrap';
    const runtimeCommands = process.platform === 'darwin' ? ['sandbox-exec', 'python3'] : ['bwrap', 'python3'];
    const runtimeAvailable = (await Promise.all(runtimeCommands.map(commandAvailable))).every(Boolean);
    const manifest = await readManifest(this.options.manifestPath);
    const definitions = manifest.dependencies.filter(dependency => isHostDependency(dependency, currentPlatform()) && dependency.id.startsWith('documents.'));
    const statuses = await Promise.all(definitions.map(async dependency => {
      const installed = await probe(dependency.probe);
      const installable = dependency.install?.[currentPlatform()] !== undefined;
      const reason = installed ? undefined : dependency.manual ?? dependency.note;
      return { id: dependency.id, label: dependency.label, installed, installable, ...(reason === undefined ? {} : { reason }) } satisfies NativeDependencyStatus;
    }));
    const runtimeStatus: NativeDependencyStatus = {
      id: `sandbox.${runtime}.base`,
      label: runtime === 'seatbelt' ? 'macOS Seatbelt runtime' : 'Linux bubblewrap runtime',
      installed: runtimeAvailable,
      installable: false,
      ...(runtimeAvailable ? {} : { reason: `The ${runtime} runtime requires ${runtimeCommands.join(', ')} on PATH.` }),
    };
    const allStatuses = [runtimeStatus, ...statuses];
    return {
      runtime,
      distribution: options.distribution,
      profile: options.profile,
      available: runtimeAvailable,
      statuses: allStatuses,
      installed: allStatuses.filter(status => status.installed).map(status => status.id),
      missing: allStatuses.filter(status => !status.installed && status.installable).map(status => status.id),
      manual: allStatuses.filter(status => !status.installed && !status.installable).map(status => status.id),
      failed: [],
    };
  }

  private async inspect(definitions: readonly DependencyDefinition[], platform: SupportedPlatform): Promise<NativeDependencyReport> {
    const statuses = await Promise.all(definitions.map(async dependency => {
      const installed = await probe(dependency.probe);
      const installable = dependency.install?.[platform] !== undefined;
      const reason = installed ? undefined : dependency.manual ?? dependency.note;
      return { id: dependency.id, label: dependency.label, installed, installable, ...(reason === undefined ? {} : { reason }) } satisfies NativeDependencyStatus;
    }));
    return {
      platform,
      statuses,
      installed: statuses.filter(status => status.installed).map(status => status.id),
      missing: statuses.filter(status => !status.installed && status.installable).map(status => status.id),
      manual: statuses.filter(status => !status.installed && !status.installable).map(status => status.id),
      failed: [],
      restartRequired: false,
    };
  }
}

function disabledGuestReport(options: GuestDependencyQuery): GuestDependencyReport {
  const runtime = process.platform === 'darwin' ? 'seatbelt' : process.platform === 'linux' ? 'bubblewrap' : 'wsl2';
  return {
    runtime,
    distribution: options.distribution,
    profile: options.profile,
    available: false,
    statuses: [{ id: `sandbox.${runtime}.runtime`, label: 'Sandbox runtime', installed: false, installable: false, reason: 'The Desktop sandbox is disabled in Settings.' }],
    installed: [],
    missing: [],
    manual: [`sandbox.${runtime}.runtime`],
    failed: [],
  };
}

async function readManifest(filePath: string): Promise<DependencyManifest> {
  await access(filePath, constants.R_OK);
  const value: unknown = JSON.parse(await readFile(filePath, 'utf8'));
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { dependencies?: unknown }).dependencies)) throw new Error(`Invalid native dependency manifest: ${filePath}`);
  return value as DependencyManifest;
}

function isHostDependency(dependency: DependencyDefinition, platform: SupportedPlatform): boolean {
  return (dependency.target ?? 'host') === 'host' && dependency.platforms.includes(platform);
}

function isGuestDependency(dependency: DependencyDefinition, profile: VmEnvironmentProfile): boolean {
  return dependency.target === 'guest' && dependency.platforms.includes('win32') && dependency.guest?.runtime === 'wsl2' && dependency.guest.profiles.includes(profile);
}

async function probe(probeDefinition: DependencyProbe): Promise<boolean> {
  if (probeDefinition.type === 'manual') return false;
  if (probeDefinition.type === 'command') return commandAvailable(probeDefinition.command);
  if (probeDefinition.type === 'commandAny') return (await Promise.all(probeDefinition.commands.map(commandAvailable))).some(Boolean);
  if (probeDefinition.type === 'commandsAll') return (await Promise.all(probeDefinition.commands.map(commandAvailable))).every(Boolean);
  if (probeDefinition.type === 'commandGroups') return (await Promise.all(probeDefinition.groups.map(async group => (await Promise.all(group.map(commandAvailable))).some(Boolean)))).every(Boolean);
  if (probeDefinition.type === 'pythonImport') {
    for (const command of process.platform === 'win32' ? ['py', 'python', 'python3'] : ['python3', 'python']) {
      if (await commandWorks(command, ['-c', `import ${probeDefinition.module}`])) return true;
    }
    return false;
  }
  return false;
}

type GuestProbe =
  | { readonly type: 'guestCommandsAll'; readonly commands: readonly string[] }
  | { readonly type: 'guestCommandsAndPaths'; readonly commands: readonly string[]; readonly paths: readonly string[] };

async function inspectGuest(definitions: readonly DependencyDefinition[], distribution: string, profile: VmEnvironmentProfile): Promise<GuestDependencyReport> {
  const available = await guestCommandWorks(distribution, ['true'], 10_000);
  const statuses = await Promise.all(definitions.map(async dependency => {
    const probeDefinition = dependency.probe as unknown as GuestProbe;
    const installed = available && await guestProbeWorks(probeDefinition, distribution);
    const installable = dependency.guest?.packages?.apt?.length !== undefined && dependency.guest.packages.apt.length > 0 || dependency.guest?.npm !== undefined;
    const reason = installed ? undefined : dependency.manual ?? dependency.note ?? (!available ? 'The selected WSL2 distribution is unavailable.' : undefined);
    return { id: dependency.id, label: dependency.label, installed, installable, ...(reason === undefined ? {} : { reason }) } satisfies NativeDependencyStatus;
  }));
  return {
    runtime: 'wsl2',
    distribution,
    profile,
    available,
    statuses,
    installed: statuses.filter(status => status.installed).map(status => status.id),
    missing: available ? statuses.filter(status => !status.installed && status.installable).map(status => status.id) : [],
    manual: statuses.filter(status => !status.installed && !status.installable).map(status => status.id),
    failed: [],
  };
}

async function guestCommandWorks(distribution: string, args: readonly string[], timeoutMs: number): Promise<boolean> {
  try { await runGuestCommand(distribution, args, timeoutMs); return true; } catch { return false; }
}

async function guestProbeWorks(probe: GuestProbe, distribution: string): Promise<boolean> {
  const commands = 'commands' in probe ? probe.commands.map(command => guestCommandWorks(distribution, ['bash', '-lc', `command -v -- ${quoteGuestCommand(command)}`], 5_000)) : [];
  const paths = 'paths' in probe ? probe.paths.map(path => guestCommandWorks(distribution, ['bash', '-lc', `test -e -- ${quoteGuestPath(path)}`], 5_000)) : [];
  return (await Promise.all([...commands, ...paths])).every(Boolean);
}

async function runGuestCommand(distribution: string, args: readonly string[], timeoutMs: number): Promise<void> {
  await runGuestOutput(distribution, args, timeoutMs);
}

async function runGuestOutput(distribution: string, args: readonly string[], timeoutMs: number): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const result = await runBoundedCommand('wsl.exe', ['--distribution', distribution, '--user', 'root', '--exec', ...args], { maxOutputBytes: 4 * 1024 * 1024, timeoutMs });
  return { stdout: decodeWslOutput(result.stdout), stderr: result.stderr };
}

async function resolveGuestAptPackages(distribution: string, packages: readonly string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const packageName of packages) {
    const result = await runGuestOutput(distribution, ['apt-cache', 'policy', packageName], 30_000);
    const candidate = /^\s*Candidate:\s*(\S+)\s*$/mu.exec(result.stdout)?.[1];
    if (candidate === undefined || candidate === '(none)') throw new Error(`No apt candidate version is available for '${packageName}'.`);
    resolved.push(`${packageName}=${candidate}`);
  }
  return resolved;
}

async function ensureGuestDistribution(distribution: string, imagePath: string, dataDirectory = join(dirname(imagePath), 'state')): Promise<void> {
  const registered = await isRegisteredDistribution(distribution);
  if (registered === true) throw new Error(`The WSL2 distribution '${distribution}' is registered but unavailable. Restart WSL2 or Windows, then retry.`);
  if (registered === undefined) throw new Error(`The WSL2 distribution registry could not be queried. Restart WSL2 or Windows, then retry.`);
  await access(imagePath, constants.R_OK);
  await mkdir(dataDirectory, { recursive: true });
  await runBoundedCommand('wsl.exe', ['--import', distribution, join(dataDirectory, distribution), imagePath, '--version', '2'], { maxOutputBytes: 4 * 1024 * 1024, timeoutMs: 60 * 60 * 1_000 });
}

async function isRegisteredDistribution(distribution: string): Promise<boolean | undefined> {
  try {
    const result = await runBoundedCommand('wsl.exe', ['--list', '--quiet'], { maxOutputBytes: 64 * 1024, timeoutMs: 10_000 });
    return decodeWslOutput(result.stdout).split(/\r?\n/u).some(value => value.replace(/^\s*[*]?\s*/u, '').trim() === distribution);
  } catch {
    return undefined;
  }
}

function decodeWslOutput(value: Buffer): string {
  const utf8 = value.toString('utf8');
  return (value.includes(0) ? value.toString('utf16le') : utf8).replace(/^\uFEFF/u, '').replaceAll('\u0000', '').trim();
}

function quoteGuestCommand(command: string): string {
  if (!/^[A-Za-z0-9._+\-/]+$/u.test(command)) throw new Error('The guest dependency manifest contains an invalid command probe.');
  return command;
}

function quoteGuestPath(path: string): string {
  if (!/^\/[A-Za-z0-9._+\-/]+$/u.test(path)) throw new Error('The guest dependency manifest contains an invalid path probe.');
  return path;
}

function unique(values: readonly string[]): string[] { return [...new Set(values.filter(value => value.trim().length > 0))]; }

function guestDependencyKey(options: GuestDependencyQuery): string {
  return `${options.runtime}\u0000${options.distribution}\u0000${options.profile}`;
}

function currentPlatform(): SupportedPlatform {
  if (process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux') return process.platform;
  throw new Error(`Unsupported native dependency platform: ${process.platform}`);
}

async function findAvailableInstaller(definition: PackageInstallDefinition | undefined): Promise<PackageInstall | undefined> {
  if (definition === undefined) return undefined;
  const candidates = Array.isArray(definition) ? definition : [definition];
  for (const candidate of candidates) if (await commandAvailable(packageManagerBinary(candidate.manager))) return candidate;
  return undefined;
}

async function installWithPackageManager(install: PackageInstall): Promise<void> {
  const { command, args } = managerInvocation(install);
  await execFileAsync(command, args, { windowsHide: true, timeout: 30 * 60 * 1_000, maxBuffer: 2 * 1024 * 1024 });
}

function managerInvocation(install: PackageInstall): { readonly command: string; readonly args: readonly string[] } {
  if (install.manager === 'winget') return { command: 'winget.exe', args: ['install', '--id', install.packageId, '--exact', '--source', 'winget', '--silent', '--accept-source-agreements', '--accept-package-agreements'] };
  if (install.manager === 'brew') return { command: 'brew', args: install.cask ? ['install', '--cask', install.packageId] : ['install', install.packageId] };
  if (install.manager === 'apt') return { command: 'sudo', args: ['apt-get', 'install', '-y', ...install.packageId.split(/\s+/u)] };
  if (install.manager === 'dnf') return { command: 'sudo', args: ['dnf', 'install', '-y', ...install.packageId.split(/\s+/u)] };
  return { command: 'sudo', args: ['pacman', '-S', '--needed', '--noconfirm', ...install.packageId.split(/\s+/u)] };
}

function packageManagerBinary(manager: PackageInstall['manager']): string {
  if (manager === 'winget') return 'winget.exe';
  if (manager === 'brew') return 'brew';
  if (manager === 'apt') return 'apt-get';
  if (manager === 'dnf') return 'dnf';
  return 'pacman';
}
