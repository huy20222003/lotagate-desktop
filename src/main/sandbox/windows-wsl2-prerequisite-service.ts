import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runBoundedCommand } from '../process/bounded-command.js';

const execFileAsync = promisify(execFile);

export interface WindowsWsl2PrerequisiteStatus {
  readonly available: boolean;
  readonly restartRequired: boolean;
  readonly adminRequired: boolean;
  readonly reason?: string;
}

/** Owns Windows-only WSL2/VirtualMachinePlatform detection and repair. */
export class WindowsWsl2PrerequisiteService {
  async inspect(): Promise<WindowsWsl2PrerequisiteStatus> {
    if (process.platform !== 'win32') return { available: false, restartRequired: false, adminRequired: false, reason: 'WSL2 is supported only on Windows hosts.' };
    try {
      // `wsl --status` can remain attached to a broken WSL session when its
      // stdout is piped from Electron. Version is sufficient to confirm that
      // the host WSL runtime is installed and responds.
      await runBoundedCommand('wsl.exe', ['--version'], { maxOutputBytes: 64 * 1024, timeoutMs: 10_000 });
      return { available: true, restartRequired: false, adminRequired: false };
    } catch (error) {
      return {
        available: false,
        restartRequired: isRestartRequired(error),
        adminRequired: true,
        reason: 'WSL2 and the Windows virtualization platform are not ready. Repair requires administrator approval and may require a restart.',
      };
    }
  }

  async repair(): Promise<WindowsWsl2PrerequisiteStatus> {
    const current = await this.inspect();
    if (current.available) return current;
    if (process.platform !== 'win32') return current;
    try {
      const result = await runElevatedFeatureRepair();
      const after = await this.inspect();
      if (result.restartRequired || after.restartRequired) return { ...after, restartRequired: true, adminRequired: false, reason: 'Windows enabled the WSL2 features. Restart Windows, then open Desktop again to finish setup.' };
      return after;
    } catch (error) {
      return { ...current, reason: redact(error instanceof Error ? error.message : 'Administrator approval was not granted for WSL2 setup.') };
    }
  }
}

async function runElevatedFeatureRepair(): Promise<{ readonly restartRequired: boolean }> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$restartRequired = $false',
    "foreach ($feature in @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')) {",
    '  $result = Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart',
    '  if ($result.RestartNeeded) { $restartRequired = $true }',
    '}',
    'wsl.exe --install --no-distribution --no-launch | Out-Null',
    'wsl.exe --set-default-version 2 | Out-Null',
    '[pscustomobject]@{ restartRequired = $restartRequired } | ConvertTo-Json -Compress',
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const wrapper = [
    `$encoded = '${encoded}'`,
    "$process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded)",
    'if ($null -eq $process) { exit 1 }',
    'exit $process.ExitCode',
  ].join('; ');
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrapper], { windowsHide: true, timeout: 10 * 60 * 1_000, maxBuffer: 128 * 1024 });
  const output = result.stdout.trim();
  if (output.length === 0) return { restartRequired: false };
  try {
    const parsed: unknown = JSON.parse(output);
    return { restartRequired: typeof parsed === 'object' && parsed !== null && (parsed as { restartRequired?: unknown }).restartRequired === true };
  } catch {
    return { restartRequired: false };
  }
}

function isRestartRequired(error: unknown): boolean {
  return /restart|reboot|requires a restart/iu.test(error instanceof Error ? error.message : '');
}

function redact(value: string): string {
  return value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]');
}
