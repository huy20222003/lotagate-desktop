import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitResult { stdout: string; stderr: string; exitCode: number; }

export async function runGit(args: string[], cwd?: string): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout;
}

export async function runGitResult(args: string[], cwd: string): Promise<GitResult> {
  try {
    const result = await execFileAsync('git', args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', exitCode: typeof failure.code === 'number' ? failure.code : 1 };
  }
}
