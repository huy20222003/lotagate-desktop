import { execFile } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type { Automation } from '../../contracts/ipc/v1/automation.js';
import { LINUX_UNIT_PREFIX, MAC_LABEL, TASK_NAME } from './automation-constants.js';

const execFileAsync = promisify(execFile);
export class AutomationOsScheduler {
  private syncChain: Promise<void> = Promise.resolve();

  constructor(private readonly report?: (message: string) => void) {}

  async sync(automations: readonly Automation[]): Promise<void> {
    const operation = this.syncChain.catch(() => undefined).then(() => this.syncPlatform(automations));
    this.syncChain = operation;
    await operation;
  }

  async remove(): Promise<void> {
    const operation = this.syncChain.catch(() => undefined).then(() => this.removePlatform());
    this.syncChain = operation;
    await operation;
  }

  private async syncPlatform(automations: readonly Automation[]): Promise<void> {
    const hasScheduledAutomation = automations.some(item => item.enabled && item.schedule.kind !== 'manual');
    if (process.platform === 'win32') return hasScheduledAutomation ? this.installWindows() : this.removeWindows();
    if (process.platform === 'darwin') return hasScheduledAutomation ? this.installMac() : this.removeMac();
    if (process.platform === 'linux') return hasScheduledAutomation ? this.installLinux() : this.removeLinux();
    this.report?.(`OS scheduling is not supported on ${process.platform}.`);
  }

  private async removePlatform(): Promise<void> {
    if (process.platform === 'win32') return this.removeWindows();
    if (process.platform === 'darwin') return this.removeMac();
    if (process.platform === 'linux') return this.removeLinux();
  }

  private async installWindows(): Promise<void> {
    await execFileAsync('schtasks.exe', ['/Create', '/TN', TASK_NAME, '/TR', buildTaskCommand(), '/SC', 'MINUTE', '/MO', '1', '/F'], { windowsHide: true, maxBuffer: 256 * 1024 });
  }

  private async removeWindows(): Promise<void> {
    try {
      await execFileAsync('schtasks.exe', ['/Delete', '/TN', TASK_NAME, '/F'], { windowsHide: true, maxBuffer: 256 * 1024 });
    } catch (error) {
      if (!isMissingSchedulerError(error)) throw error;
    }
  }

  private async installMac(): Promise<void> {
    const path = macPlistPath();
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, buildMacPlist(), 'utf8');
    await execFileAsync('launchctl', ['bootout', macDomain(), MAC_LABEL]).catch(error => { if (!isMissingSchedulerError(error)) throw error; });
    await execFileAsync('launchctl', ['bootstrap', macDomain(), path]);
  }

  private async removeMac(): Promise<void> {
    await execFileAsync('launchctl', ['bootout', macDomain(), MAC_LABEL]).catch(error => { if (!isMissingSchedulerError(error)) throw error; });
    await unlink(macPlistPath()).catch(error => { if (!isMissingFile(error)) throw error; });
  }

  private async installLinux(): Promise<void> {
    const directory = linuxUnitDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${LINUX_UNIT_PREFIX}.service`), buildLinuxService(), 'utf8');
    await writeFile(join(directory, `${LINUX_UNIT_PREFIX}.timer`), buildLinuxTimer(), 'utf8');
    await execFileAsync('systemctl', ['--user', 'daemon-reload']);
    await execFileAsync('systemctl', ['--user', 'enable', '--now', `${LINUX_UNIT_PREFIX}.timer`]);
  }

  private async removeLinux(): Promise<void> {
    await execFileAsync('systemctl', ['--user', 'disable', '--now', `${LINUX_UNIT_PREFIX}.timer`]).catch(error => { if (!isMissingSchedulerError(error)) throw error; });
    await execFileAsync('systemctl', ['--user', 'daemon-reload']).catch(error => { if (!isMissingSchedulerError(error)) throw error; });
    await Promise.all([unlink(join(linuxUnitDirectory(), `${LINUX_UNIT_PREFIX}.service`)), unlink(join(linuxUnitDirectory(), `${LINUX_UNIT_PREFIX}.timer`))].map(operation => operation.catch(error => { if (!isMissingFile(error)) throw error; })));
  }
}

function buildTaskCommand(): string {
  const executable = app.getPath('exe');
  const args = app.isPackaged ? ['--automation-dispatch'] : [app.getAppPath(), '--automation-dispatch'];
  return [executable, ...args].map(quoteCommandPart).join(' ');
}

function quoteCommandPart(value: string): string { return `"${value.replace(/"/gu, '\\"')}"`; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Unable to update the Windows automation scheduler.'; }
function isMissingFile(error: unknown): boolean { return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'; }
function isMissingSchedulerError(error: unknown): boolean { return isMissingFile(error) || /cannot find|does not exist|not found|could not be found|no such service/iu.test(errorMessage(error)); }
function macPlistPath(): string { return join(app.getPath('userData'), `${MAC_LABEL}.plist`); }
function macDomain(): string { return `gui/${process.getuid?.() ?? 0}`; }
function linuxUnitDirectory(): string { return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'systemd', 'user'); }
function buildMacPlist(): string { return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${xmlEscape(MAC_LABEL)}</string><key>ProgramArguments</key><array>${[app.getPath('exe'), ...(app.isPackaged ? ['--automation-dispatch'] : [app.getAppPath(), '--automation-dispatch'])].map(value => `<string>${xmlEscape(value)}</string>`).join('')}</array><key>StartInterval</key><integer>60</integer><key>RunAtLoad</key><true/></dict></plist>\n`; }
function buildLinuxService(): string { const executable = systemdEscape(app.getPath('exe')); const args = app.isPackaged ? ['--automation-dispatch'] : [app.getAppPath(), '--automation-dispatch']; return `[Unit]\nDescription=LotaGate Desktop automation dispatcher\n\n[Service]\nType=oneshot\nExecStart=${executable} ${args.map(systemdEscape).join(' ')}\n`; }
function buildLinuxTimer(): string { return `[Unit]\nDescription=Run LotaGate Desktop automation dispatcher every minute\n\n[Timer]\nOnCalendar=*:0/1\nPersistent=true\nUnit=${LINUX_UNIT_PREFIX}.service\n\n[Install]\nWantedBy=timers.target\n`; }
function xmlEscape(value: string): string { return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&apos;'); }
function systemdEscape(value: string): string { return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/%/gu, '%%') }"`; }
