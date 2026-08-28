// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDesktopCommand, executeDesktopCommandResult } from './desktop-command-client.js';

describe('desktop command client', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('cancels a command when the renderer timeout expires', async () => {
    vi.useFakeTimers();
    let listener: ((envelope: { cwd: string; event: { event: string; data: Record<string, unknown> } }) => void) | undefined;
    const commandCancel = vi.fn(() => {
      listener?.({ cwd: 'C:\\workspace', event: { event: 'command.cancelled', data: { commandId: 'command-1' } } });
      return Promise.resolve({ accepted: true });
    });
    window.lotagate = { agent: { commandExecute: vi.fn().mockResolvedValue({ commandId: 'command-1' }), commandCancel, onEvent: vi.fn(callback => { listener = callback as typeof listener; return () => undefined; }) } } as unknown as typeof window.lotagate;

    const pending = executeDesktopCommand('C:\\workspace', { actionId: 'workspace.inspect', positionals: [], options: {} });
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await vi.advanceTimersByTimeAsync(120_000);

    await rejected;
    expect(commandCancel).toHaveBeenCalledWith('C:\\workspace', 'command-1');
  });

  it('collects structured command output while preserving the text fallback', async () => {
    let listener: ((envelope: { cwd: string; event: { event: string; data: Record<string, unknown> } }) => void) | undefined;
    window.lotagate = { agent: {
      commandExecute: vi.fn(() => {
        queueMicrotask(() => listener?.({ cwd: 'C:\\workspace', event: { event: 'command.output', data: { commandId: 'command-1', content: 'No skills available.\n', structured: { kind: 'skill', items: [] } } } }));
        queueMicrotask(() => listener?.({ cwd: 'C:\\workspace', event: { event: 'command.completed', data: { commandId: 'command-1', exitCode: 0 } } }));
        return Promise.resolve({ commandId: 'command-1' });
      }),
      commandCancel: vi.fn().mockResolvedValue({ accepted: true }),
      onEvent: vi.fn(callback => { listener = callback as typeof listener; return () => undefined; }),
    } } as unknown as typeof window.lotagate;

    await expect(executeDesktopCommandResult('C:\\workspace', { actionId: 'skill.list', positionals: [], options: {} })).resolves.toEqual({
      content: 'No skills available.\n',
      structured: { kind: 'skill', items: [] },
    });
  });
});
