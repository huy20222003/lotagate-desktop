import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation, AutomationSchedule } from '../../contracts/ipc/v1/automation.js';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  mkdir: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => 'C:\\Workspace\\lota-gate\\desktop'),
    getPath: vi.fn((name: string) => name === 'exe' ? 'C:\\Program Files\\LotaGate\\LotaGate.exe' : 'C:\\Users\\Test\\AppData\\Roaming\\LotaGate'),
  },
}));

vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));
vi.mock('node:fs/promises', () => ({ mkdir: mocks.mkdir, unlink: mocks.unlink, writeFile: mocks.writeFile }));
vi.mock('electron', () => ({ app: mocks.app }));

import { AutomationOsScheduler } from './automation-os-scheduler.js';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void { Object.defineProperty(process, 'platform', { configurable: true, value: platform }); }
function automation(schedule: AutomationSchedule, enabled = true): Automation {
  const timestamp = '2026-08-28T00:00:00.000Z';
  return { id: 'automation-1', name: 'Test automation', description: '', prompt: 'Run test', workspaceId: 'workspace-1', worktree: false, skills: [], tools: [], permissionPolicy: 'ask', browserAccess: 'disabled', schedule, retryPolicy: { maxAttempts: 0, backoffMs: 1_000 }, timeoutMs: 60_000, notifications: true, keepSession: true, enabled, nextRunAt: null, lastRunAt: null, lastError: null, createdAt: timestamp, updatedAt: timestamp };
}
function commandArgs(index = 0): readonly unknown[] { return mocks.execFile.mock.calls[index] ?? []; }

describe('AutomationOsScheduler', () => {
  beforeEach(() => {
    mocks.execFile.mockReset();
    mocks.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback === 'function') callback(null, { stdout: '', stderr: '' });
      return new EventEmitter();
    });
    mocks.mkdir.mockClear();
    mocks.unlink.mockClear();
    mocks.writeFile.mockClear();
    mocks.app.getAppPath.mockClear();
    mocks.app.getPath.mockClear();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform });
    delete process.env['XDG_CONFIG_HOME'];
  });

  it('installs a Windows task for an enabled scheduled automation', async () => {
    setPlatform('win32');
    await new AutomationOsScheduler().sync([automation({ kind: 'interval', everyMinutes: 5, timezone: 'UTC' })]);
    const args = commandArgs();
    expect(args[0]).toBe('schtasks.exe');
    expect(args[1]).toEqual(expect.arrayContaining(['/Create', '/TN', 'LotaGate Desktop Automation Dispatcher', '/SC', 'MINUTE', '/MO', '1', '/F']));
    expect((args[1] as readonly unknown[]).join(' ')).toContain('LotaGate.exe');
    expect(args[2]).toEqual(expect.objectContaining({ windowsHide: true }));
  });

  it('removes the Windows task when no enabled scheduled automation remains', async () => {
    setPlatform('win32');
    await new AutomationOsScheduler().sync([automation({ kind: 'manual' }), automation({ kind: 'daily', time: '09:00', timezone: 'UTC' }, false)]);
    expect(commandArgs()[0]).toBe('schtasks.exe');
    expect(commandArgs()[1]).toEqual(['/Delete', '/TN', 'LotaGate Desktop Automation Dispatcher', '/F']);
  });

  it('ignores a missing Windows task during cleanup', async () => {
    setPlatform('win32');
    mocks.execFile.mockImplementationOnce((...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback === 'function') callback(new Error('The system cannot find the file specified.'));
      return new EventEmitter();
    });
    await expect(new AutomationOsScheduler().remove()).resolves.toBeUndefined();
  });

  it('writes and bootstraps a macOS launch agent for scheduled work', async () => {
    setPlatform('darwin');
    await new AutomationOsScheduler().sync([automation({ kind: 'daily', time: '09:00', timezone: 'UTC' })]);
    const launchctlDomain = `gui/${process.getuid?.() ?? 0}`;
    expect(mocks.writeFile).toHaveBeenCalledWith(expect.stringContaining('com.lotagate.desktop.automation.plist'), expect.stringContaining('<key>StartInterval</key><integer>60</integer>'), 'utf8');
    expect(commandArgs(0)[0]).toBe('launchctl');
    expect(commandArgs(0)[1]).toEqual(['bootout', launchctlDomain, 'com.lotagate.desktop.automation']);
    expect(commandArgs(1)[1]).toEqual(['bootstrap', launchctlDomain, expect.stringContaining('com.lotagate.desktop.automation.plist')]);
  });

  it('writes and enables a Linux systemd timer for scheduled work', async () => {
    setPlatform('linux');
    process.env['XDG_CONFIG_HOME'] = 'C:\\Temp\\lotagate-config';
    await new AutomationOsScheduler().sync([automation({ kind: 'cron', expression: '0 9 * * 1-5', timezone: 'UTC' })]);
    expect(mocks.writeFile).toHaveBeenCalledWith(expect.stringContaining('lotagate-desktop-automation.service'), expect.stringContaining('Type=oneshot'), 'utf8');
    expect(mocks.writeFile).toHaveBeenCalledWith(expect.stringContaining('lotagate-desktop-automation.timer'), expect.stringContaining('OnCalendar=*:0/1'), 'utf8');
    expect(commandArgs(0)[0]).toBe('systemctl');
    expect(commandArgs(0)[1]).toEqual(['--user', 'daemon-reload']);
    expect(commandArgs(1)[0]).toBe('systemctl');
    expect(commandArgs(1)[1]).toEqual(['--user', 'enable', '--now', 'lotagate-desktop-automation.timer']);
  });

  it('removes Linux timer files and tolerates an already absent service', async () => {
    setPlatform('linux');
    process.env['XDG_CONFIG_HOME'] = 'C:\\Temp\\lotagate-config';
    await new AutomationOsScheduler().remove();
    expect(commandArgs(0)[0]).toBe('systemctl');
    expect(commandArgs(0)[1]).toEqual(['--user', 'disable', '--now', 'lotagate-desktop-automation.timer']);
    expect(commandArgs(1)[0]).toBe('systemctl');
    expect(commandArgs(1)[1]).toEqual(['--user', 'daemon-reload']);
    expect(mocks.unlink).toHaveBeenCalledTimes(2);
  });

  it('reports unsupported operating systems without attempting installation', async () => {
    setPlatform('aix');
    const report = vi.fn();
    await new AutomationOsScheduler(report).sync([automation({ kind: 'interval', everyMinutes: 5, timezone: 'UTC' })]);
    expect(report).toHaveBeenCalledWith('OS scheduling is not supported on aix.');
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});
