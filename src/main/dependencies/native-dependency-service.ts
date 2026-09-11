import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { commandAvailable, commandWorks } from '../process/command-availability.js';

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
interface DependencyDefinition {
  readonly id: string;
  readonly label: string;
  readonly platforms: readonly SupportedPlatform[];
  readonly probe: DependencyProbe;
  readonly install?: Partial<Record<SupportedPlatform, PackageInstallDefinition>>;
  readonly manual?: string;
  readonly note?: string;
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
  readonly log: (message: string, fields?: Record<string, unknown>) => void;
}

/**
 * Owns the one manifest-driven dependency flow used by packaged Desktop and
 * the developer installer script. Package managers are invoked without a
 * shell, and missing optional/manual prerequisites never block the app.
 */
export class NativeDependencyService {
  private readonly options: NativeDependencyServiceOptions;

  public constructor(options: NativeDependencyServiceOptions) {
    this.options = options;
  }

  public async ensureInstalled(automatic: boolean): Promise<NativeDependencyReport> {
    const manifest = await readManifest(this.options.manifestPath);
    const platform = currentPlatform();
    const definitions = manifest.dependencies.filter(dependency => dependency.platforms.includes(platform));
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
    return this.inspect(manifest.dependencies.filter(dependency => dependency.platforms.includes(platform)), platform);
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

async function readManifest(filePath: string): Promise<DependencyManifest> {
  await access(filePath, constants.R_OK);
  const value: unknown = JSON.parse(await readFile(filePath, 'utf8'));
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { dependencies?: unknown }).dependencies)) throw new Error(`Invalid native dependency manifest: ${filePath}`);
  return value as DependencyManifest;
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
