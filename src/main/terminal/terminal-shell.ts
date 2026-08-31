import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { TerminalShell } from '../../contracts/ipc/v1/settings.js';

export interface TerminalShellLaunch { command: string; args: string[]; }

export function resolveTerminalShell(shell: TerminalShell, platform = process.platform, environment: NodeJS.ProcessEnv = process.env, fileExists: (path: string) => boolean = existsSync): TerminalShellLaunch {
  if (shell === 'powershell') return platform === 'win32'
    ? { command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NoExit'] }
    : { command: 'pwsh', args: ['-NoLogo', '-NoProfile', '-NoExit'] };
  if (shell === 'cmd') return platform === 'win32'
    ? { command: 'cmd.exe', args: ['/d', '/q'] }
    : { command: environment['SHELL'] ?? '/bin/sh', args: ['-i'] };
  if (platform !== 'win32') return { command: 'bash', args: ['--login', '-i'] };
  const candidates = [
    environment['ProgramFiles'] === undefined ? undefined : join(environment['ProgramFiles'], 'Git', 'bin', 'bash.exe'),
    environment['ProgramFiles(x86)'] === undefined ? undefined : join(environment['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    environment['LOCALAPPDATA'] === undefined ? undefined : join(environment['LOCALAPPDATA'], 'Programs', 'Git', 'bin', 'bash.exe'),
  ].filter((candidate): candidate is string => candidate !== undefined);
  const command = candidates.find(fileExists);
  if (command === undefined) throw new Error('Git Bash is not installed or could not be located.');
  return { command, args: ['--login', '-i'] };
}
