import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Resolves an executable through the current user environment without invoking a shell. */
export async function commandAvailable(command: string): Promise<boolean> {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    await execFileAsync(lookup, [command], { windowsHide: true, timeout: 2_000, maxBuffer: 16 * 1024 });
    return true;
  } catch {
    return false;
  }
}

export async function firstAvailableCommand(commands: readonly string[]): Promise<string | undefined> {
  for (const command of commands) if (await commandAvailable(command)) return command;
  return undefined;
}

/** Verifies a helper and a small, fixed probe without invoking a shell. */
export async function commandWorks(command: string, args: readonly string[]): Promise<boolean> {
  try {
    await execFileAsync(command, [...args], { windowsHide: true, timeout: 2_000, maxBuffer: 16 * 1024 });
    return true;
  } catch {
    return false;
  }
}
