import { describe, expect, it } from 'vitest';
import { runBoundedCommand } from './bounded-command.js';

describe('runBoundedCommand', () => {
  it('keeps UTF-16 native diagnostics when a command fails', async () => {
    const script = "process.stderr.write(Buffer.from('Access is denied.\\r\\n', 'utf16le')); process.exitCode = 1;";

    await expect(runBoundedCommand(process.execPath, ['-e', script], { maxOutputBytes: 1024, timeoutMs: 5_000 })).rejects.toThrow('Access is denied.');
  });
});
