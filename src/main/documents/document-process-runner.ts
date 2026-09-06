import { spawn } from 'node:child_process';
import { terminateDesktopProcess } from '../process/process-termination.js';

// Document extraction and Office conversions can legitimately produce larger
// JSON responses and take longer than the generic command execution path.
// Keep both limits bounded while allowing realistic workbooks and documents.
export const DOCUMENT_BACKEND_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
export const DOCUMENT_BACKEND_TIMEOUT_MS = 10 * 60 * 1_000;

export async function runDocumentBackend(scriptPath: string, cwd: string, input: { action: string; path: string; params: Record<string, unknown> }, signal?: AbortSignal): Promise<unknown> {
  if (process.platform !== 'win32') throw new Error('The document host currently requires the Windows document backend.');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let bytes = 0; let settled = false; let timer: NodeJS.Timeout;
    const finish = (error?: Error, result?: unknown): void => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); if (error !== undefined) reject(error); else resolve(result); };
    const stop = (message: string): void => { void terminateDesktopProcess(child).finally(() => finish(new Error(message))); };
    const abort = (): void => stop('Document action was cancelled.');
    const append = (chunk: Buffer, target: 'stdout' | 'stderr'): void => { const text = chunk.toString('utf8'); bytes += Buffer.byteLength(text, 'utf8'); if (bytes > DOCUMENT_BACKEND_MAX_OUTPUT_BYTES) { stop('Document backend output exceeded the supported limit.'); return; } if (target === 'stdout') stdout += text; else stderr += text; };
    timer = setTimeout(() => stop('Document backend timed out.'), DOCUMENT_BACKEND_TIMEOUT_MS);
    child.stdout.on('data', chunk => append(chunk, 'stdout')); child.stderr.on('data', chunk => append(chunk, 'stderr'));
    child.once('error', error => finish(error));
    child.once('close', code => { if (settled) return; if (code !== 0) { finish(new Error(stderr.trim() || `Document backend exited with code ${String(code)}.`)); return; } try { finish(undefined, JSON.parse(stdout)); } catch { finish(new Error('Document backend returned invalid JSON.')); } });
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    child.stdin.end(JSON.stringify({ cwd, ...input }));
  });
}
