import { describe, expect, it } from 'vitest';
import { extractIpcCorrelation } from './logged-ipc.js';

describe('extractIpcCorrelation', () => {
  it('extracts correlation fields without recording IPC payloads', () => {
    expect(extractIpcCorrelation('task.queuePrompt', ['task-1', { sessionId: 'session-1', turnId: 'turn-1', prompt: 'private' }])).toEqual({
      sessionId: 'session-1',
      turnId: 'turn-1',
      taskId: 'task-1',
    });
  });

  it('maps positional task and terminal identifiers for channels without envelopes', () => {
    expect(extractIpcCorrelation('checkpoint.undo', ['/workspace', 'task-1', 'turn-1'])).toEqual({ taskId: 'task-1', turnId: 'turn-1' });
    expect(extractIpcCorrelation('terminal.close', ['session-1'])).toEqual({ sessionId: 'session-1' });
  });
});
