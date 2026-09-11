import { describe, expect, it } from 'vitest';
import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { finalAssistantResponseForTurn } from './assistant-response.js';

const createdAt = '2026-09-11T00:00:00.000Z';

function assistant(id: string, text: string, turnId: string, phase: 'progress' | 'final', taskId = 'task-1'): Activity {
  return { id, taskId, kind: 'assistant', text, metadata: { turnId, segmentId: id, assistantPhase: phase }, createdAt };
}

describe('assistant final response projection', () => {
  it('returns only completed final segments for the requested turn', () => {
    const response = finalAssistantResponseForTurn([
      assistant('progress-1', 'I am checking the file.', 'turn-1', 'progress'),
      assistant('final-1', 'The file is ready.', 'turn-1', 'final'),
      assistant('final-2', 'You can download it now.', 'turn-1', 'final'),
      assistant('other-turn', 'A different answer.', 'turn-2', 'final'),
    ], 'task-1', 'turn-1');

    expect(response).toEqual({ turnId: 'turn-1', text: 'The file is ready.\n\nYou can download it now.' });
  });

  it('ignores progress output and activities from another task', () => {
    expect(finalAssistantResponseForTurn([
      assistant('progress-1', 'Still working.', 'turn-1', 'progress'),
      assistant('other-task', 'Not this task.', 'turn-1', 'final', 'task-2'),
    ], 'task-1', 'turn-1')).toBeUndefined();
  });
});
