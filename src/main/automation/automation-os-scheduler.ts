import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app } from 'electron';
import type { Automation } from '../../contracts/ipc/v1/automation.js';

const execFileAsync = promisify(execFile);
const TASK_NAME = 'LotaGate Desktop Automation Dispatcher';

export class AutomationOsScheduler {
  constructor(private readonly report?: (message: string) => void) {}

  async sync(automations: readonly Automation[]): Promise<void> {
    if (process.platform !== 'win32') return;
    const hasScheduledAutomation = automations.some(item => item.enabled && item.schedule.kind !== 'manual');
    if (!hasScheduledAutomation) {
      await this.remove().catch(error => this.report?.(errorMessage(error)));
      return;
    }
    await execFileAsync('schtasks.exe', [
      '/Create', '/TN', TASK_NAME, '/TR', buildTaskCommand(), '/SC', 'MINUTE', '/MO', '1', '/F',
    ], { windowsHide: true, maxBuffer: 256 * 1024 });
  }

  async remove(): Promise<void> {
    if (process.platform !== 'win32') return;
    try {
      await execFileAsync('schtasks.exe', ['/Delete', '/TN', TASK_NAME, '/F'], { windowsHide: true, maxBuffer: 256 * 1024 });
    } catch (error) {
      const message = errorMessage(error);
      if (!/cannot find|does not exist|not found/iu.test(message)) throw error;
    }
  }
}

function buildTaskCommand(): string {
  const executable = app.getPath('exe');
  const args = app.isPackaged ? ['--automation-dispatch'] : [app.getAppPath(), '--automation-dispatch'];
  return [executable, ...args].map(quoteCommandPart).join(' ');
}

function quoteCommandPart(value: string): string { return `"${value.replace(/"/gu, '\\"')}"`; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Unable to update the Windows automation scheduler.'; }
