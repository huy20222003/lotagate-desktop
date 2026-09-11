import { describe, expect, it } from 'vitest';
import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { mergeChatActivities } from './conversation-activities.js';

function activity(kind: Activity['kind'], text: string, turnId?: string): Activity {
  return { id: `${kind}-${text}`, taskId: 'task-1', kind, text, metadata: turnId === undefined ? {} : { turnId }, createdAt: '2026-08-26T00:00:00.000Z' };
}

describe('mergeChatActivities', () => {
  it('keeps a failed turn error in the same assistant message', () => {
    const result = mergeChatActivities([activity('user', 'Change the file'), activity('assistant', 'I changed it.', 'turn-1'), activity('error', 'The response could not be completed: Agent failed.', 'turn-1')]);
    expect(result).toHaveLength(2);
    expect(result[1]?.text).toBe('I changed it.\n\nThe response could not be completed: Agent failed.');
  });

  it('keeps a failed turn as one message when no assistant text exists', () => {
    const result = mergeChatActivities([activity('user', 'Read the file'), activity('error', 'The response could not be completed: Agent failed.', 'turn-2')]);
    expect(result).toHaveLength(2);
    expect(result[1]?.kind).toBe('error');
  });

  it('keeps interrupted progress in Worked For instead of moving it into the final response', () => {
    const result = mergeChatActivities([
      activity('user', 'Open Paint'),
      { ...activity('assistant', 'I am checking the canvas.', 'turn-3'), metadata: { turnId: 'turn-3', segmentId: 'run-3:1', assistantPhase: 'progress', assistantInterrupted: true } },
      activity('error', 'The response could not be completed.', 'turn-3'),
    ]);

    expect(result).toHaveLength(2);
    expect(result[1]?.kind).toBe('error');
    expect(result[1]?.text).toBe('The response could not be completed.');
  });

  it('does not restore transient command statuses into the transcript', () => {
    const result = mergeChatActivities([
      activity('user', 'Run the check'),
      activity('assistant', 'Command completed.'),
      activity('assistant', 'The check passed.'),
    ]);
    expect(result).toEqual([
      expect.objectContaining({ kind: 'user', text: 'Run the check' }),
      expect.objectContaining({ kind: 'assistant', text: 'The check passed.' }),
    ]);
  });

  it('filters legacy ASCII command status text loaded from older activity logs', () => {
    const result = mergeChatActivities([
      activity('user', 'Generate an image'),
      activity('assistant', 'Running command...'),
      activity('assistant', 'Generated image saved.'),
    ]);
    expect(result).toEqual([
      expect.objectContaining({ kind: 'user', text: 'Generate an image' }),
      expect.objectContaining({ kind: 'assistant', text: 'Generated image saved.' }),
    ]);
  });

  it('keeps progress narration out of the final conversation transcript', () => {
    const result = mergeChatActivities([
      activity('user', 'Inspect the route'),
      { ...activity('assistant', 'I will inspect the route first.', 'turn-1'), metadata: { turnId: 'turn-1', segmentId: 'run-1:1', assistantPhase: 'progress' } },
      { ...activity('assistant', 'The route is correct.', 'turn-1'), metadata: { turnId: 'turn-1', segmentId: 'run-1:2', assistantPhase: 'final' } },
    ]);

    expect(result.map(item => item.text)).toEqual(['Inspect the route', 'The route is correct.']);
  });

  it('merges partial assistant segments from one failed turn into one response', () => {
    const result = mergeChatActivities([
      activity('user', 'Create the file'),
      { ...activity('assistant', 'I am creating it.', 'turn-1'), metadata: { turnId: 'turn-1', segmentId: 'run-1:1', assistantPhase: 'final', assistantInterrupted: true } },
      { ...activity('assistant', 'The file is ready.', 'turn-1'), metadata: { turnId: 'turn-1', segmentId: 'run-1:2', assistantPhase: 'final', assistantInterrupted: true } },
      activity('error', 'The response could not be completed.', 'turn-1'),
    ]);

    expect(result).toHaveLength(2);
    expect(result[1]?.text).toBe('I am creating it.\n\nThe file is ready.\n\nThe response could not be completed.');
  });

  it('keeps completed assistant segments independent', () => {
    const result = mergeChatActivities([
      activity('user', 'Run the task'),
      { ...activity('assistant', 'Before the tool.', 'turn-1'), metadata: { turnId: 'turn-1', segmentId: 'run-1:1', assistantPhase: 'final' } },
      { ...activity('assistant', 'After the tool.', 'turn-1'), metadata: { turnId: 'turn-1', segmentId: 'run-1:2', assistantPhase: 'final' } },
    ]);

    expect(result.map(item => item.text)).toEqual(['Run the task', 'Before the tool.', 'After the tool.']);
  });
});
