import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DESKTOP_RUNTIME_LIMITS } from '../../contracts/runtime-limits.js';
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
      // `wsl --version` is only available in newer Store WSL builds. The
      // distribution listing is supported by the inbox WSL CLI as well and
      // is the read-only host probe needed before importing the shared image.
      await runBoundedCommand('wsl.exe', ['--list', '--quiet'], { maxOutputBytes: DESKTOP_RUNTIME_LIMITS.sandboxRuntimeStatusOutputBytes, timeoutMs: DESKTOP_RUNTIME_LIMITS.sandboxRuntimeHealthTimeoutMs });
      return { available: true, restartRequired: false, adminRequired: false };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'WSL2 host inspection failed.';
      // A healthy WSL host is allowed to have no user distributions yet; the
      // dependency service imports LotaGate-VM after this probe succeeds.
      if (isNoDistributionMessage(reason)) return { available: true, restartRequired: false, adminRequired: false };
      return {
        available: false,
        restartRequired: isRestartRequired(error),
        adminRequired: true,
        reason: `WSL2 host inspection failed: ${redact(reason)} Repair requires administrator approval and may require a restart.`,
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
      if (result.restartRequired || after.restartRequired) return { ...after, available: false, restartRequired: true, adminRequired: false, reason: 'Windows enabled the WSL2 features. Restart Windows, then open Desktop again to finish setup.' };
      return after;
    } catch (error) {
      return { ...current, available: false, adminRequired: true, reason: redact(error instanceof Error ? error.message : 'Administrator approval was not granted for WSL2 setup.') };
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
    'if ($restartRequired) { [pscustomobject]@{ restartRequired = $true } | ConvertTo-Json -Compress; exit 0 }',
    '$wslHelp = (& wsl.exe --help 2>&1 | Out-String)',
    'try { & wsl.exe --set-default-version 2 | Out-Null; if ($LASTEXITCODE -ne 0) { throw "wsl --set-default-version failed with exit code $LASTEXITCODE" } } catch {',
    '  if ($wslHelp -match "--update") { & wsl.exe --update | Out-Null; if ($LASTEXITCODE -ne 0) { throw "wsl --update failed with exit code $LASTEXITCODE" } }',
    '  elseif ($wslHelp -match "--no-distribution" -and $wslHelp -match "--no-launch") { & wsl.exe --install --no-distribution --no-launch | Out-Null; if ($LASTEXITCODE -ne 0) { throw "wsl --install failed with exit code $LASTEXITCODE" } }',
    '  else { throw }',
    '  & wsl.exe --set-default-version 2 | Out-Null; if ($LASTEXITCODE -ne 0) { throw "wsl --set-default-version failed after update with exit code $LASTEXITCODE" }',
    '}',
    '[pscustomobject]@{ restartRequired = $restartRequired } | ConvertTo-Json -Compress',
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const wrapper = [
    "$ErrorActionPreference = 'Stop'",
    `$encoded = '${encoded}'`,
    "$stdoutPath = [IO.Path]::GetTempFileName()",
    "$stderrPath = [IO.Path]::GetTempFileName()",
    'try {',
    "$process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath",
    'if ($null -eq $process) { exit 1 }',
    'if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath -Raw }',
    'if ($process.ExitCode -ne 0) { if (Test-Path -LiteralPath $stderrPath) { [Console]::Error.Write((Get-Content -LiteralPath $stderrPath -Raw)) }; exit $process.ExitCode }',
    '} finally { Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue }',
  ].join('; ');
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrapper], { windowsHide: true, timeout: DESKTOP_RUNTIME_LIMITS.sandboxHostRepairTimeoutMs, maxBuffer: DESKTOP_RUNTIME_LIMITS.sandboxHostRepairOutputBytes });
  const candidates = result.stdout.trim().split(/\r?\n/u).reverse();
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === 'object' && parsed !== null) return { restartRequired: (parsed as { restartRequired?: unknown }).restartRequired === true };
    } catch {
      // PowerShell can add informational lines around the JSON payload.
    }
  }
  return { restartRequired: false };
}

function isRestartRequired(error: unknown): boolean {
  return /restart|reboot|requires a restart/iu.test(error instanceof Error ? error.message : '');
}

function isNoDistributionMessage(value: string): boolean {
  return /no (?:installed )?distributions|there are no distributions|no distributions are installed/iu.test(value);
}

function redact(value: string): string {
  return value.replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]').replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED]');
}
