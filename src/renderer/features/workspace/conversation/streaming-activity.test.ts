import { describe, expect, it } from 'vitest';
import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { appendAssistantDelta, assistantStreamKey, isAssistantStreamPersisted, markAssistantTurnCompleted, reconcilePendingAssistantStreams, replaceAssistantResponse, type PendingAssistantStream } from './streaming-activity.js';

const createdAt = '2026-08-27T00:00:00.000Z';

function activity(id: string, text: string, turnId = 'turn-1'): Activity {
  return { id, taskId: 'task-1', kind: 'assistant', text, metadata: { turnId }, createdAt };
}

describe('streaming activity projection', () => {
  it('renders the first delta immediately and appends later deltas to the same turn', () => {
    const first = appendAssistantDelta([], { taskId: 'task-1', turnId: 'turn-1', content: 'Hel', createdAt });
    const next = appendAssistantDelta(first, { taskId: 'task-1', turnId: 'turn-1', content: 'lo', createdAt });

    expect(next).toHaveLength(1);
    expect(next[0]?.text).toBe('Hello');
    expect(next[0]?.metadata).toMatchObject({ turnId: 'turn-1' });
  });

  it('keeps streams from separate turns independent', () => {
    const first = appendAssistantDelta([activity('assistant-1', 'Done', 'turn-1')], { taskId: 'task-1', turnId: 'turn-2', content: 'Next', createdAt });

    expect(first).toHaveLength(2);
    expect(first[1]?.text).toBe('Next');
    expect(assistantStreamKey('task-1', 'turn-1')).not.toBe(assistantStreamKey('task-1', 'turn-2'));
  });

  it('keeps assistant segments from the same turn independent', () => {
    const first = appendAssistantDelta([], { taskId: 'task-1', turnId: 'turn-1', segmentId: 'run-1:1', content: 'Before tool.', createdAt });
    const next = appendAssistantDelta(first, { taskId: 'task-1', turnId: 'turn-1', segmentId: 'run-1:2', content: 'Final.', createdAt });

    expect(next).toHaveLength(2);
    expect(next[0]?.id).not.toBe(next[1]?.id);
    expect(assistantStreamKey('task-1', 'turn-1', 'run-1:1')).not.toBe(assistantStreamKey('task-1', 'turn-1', 'run-1:2'));
  });

  it('keeps execution workspace metadata on a streamed assistant activity', () => {
    const first = appendAssistantDelta([], { taskId: 'task-1', turnId: 'turn-1', content: 'Saved D:\\session\\file.ts', createdAt, metadata: { projectRoot: 'D:\\project', executionCwd: 'D:\\session' } });
    const next = appendAssistantDelta(first, { taskId: 'task-1', turnId: 'turn-1', content: ' successfully.', createdAt });

    expect(next[0]?.metadata).toMatchObject({ projectRoot: 'D:\\project', executionCwd: 'D:\\session', turnId: 'turn-1' });
  });

  it('removes provisional text from the current turn when the final response is replaced', () => {
    const activities: Activity[] = [
      { ...activity('assistant-1', 'A provisional claim', 'turn-1'), metadata: { turnId: 'turn-1', segmentId: 'run-1:1', assistantPhase: 'progress' } },
      { ...activity('assistant-2', 'An unrelated completed turn', 'turn-0'), metadata: { turnId: 'turn-0', segmentId: 'run-0:1', assistantPhase: 'final' } },
    ];
    const result = replaceAssistantResponse(activities, { taskId: 'task-1', turnId: 'turn-1', segmentId: 'run-1:final', content: 'The result could not be verified.', createdAt });
    expect(result.map(item => item.id)).toEqual(['assistant-2', 'assistant-replacement:task-1:run-1:final']);
    expect(result[1]).toMatchObject({ kind: 'assistant', text: 'The result could not be verified.', metadata: { turnId: 'turn-1', segmentId: 'run-1:final', assistantPhase: 'final', assistantReplacement: true } });
  });

  it('keeps partial assistant output visible when a turn fails', () => {
    const activities: Activity[] = [
      { ...activity('assistant-1', 'Partial response', 'turn-1'), metadata: { turnId: 'turn-1', segmentId: 'run-1:1', assistantPhase: 'progress' } },
      { ...activity('assistant-2', 'Previous response', 'turn-0'), metadata: { turnId: 'turn-0', segmentId: 'run-0:1', assistantPhase: 'final' } },
    ];
    const result = markAssistantTurnCompleted(activities, 'task-1', 'turn-1');
    expect(result[0]?.metadata).toMatchObject({ assistantPhase: 'progress', assistantInterrupted: true });
    expect(result[1]).toBe(activities[1]);
  });

  it('overlays a stream while persistence is catching up, then allows reconciliation', () => {
    const stream: PendingAssistantStream = { taskId: 'task-1', turnId: 'turn-1', segmentId: 'run-1:1', text: 'Hello world', createdAt };
    const stale = [{ ...activity('assistant-1', 'Hello', 'turn-1'), metadata: { turnId: 'turn-1', segmentId: 'run-1:1' } }];
    const overlay = reconcilePendingAssistantStreams(stale, [stream]);

    expect(overlay[0]?.text).toBe('Hello world');
    expect(isAssistantStreamPersisted([{ ...activity('assistant-1', 'Hello world', 'turn-1'), metadata: { turnId: 'turn-1', segmentId: 'run-1:1' } }], stream)).toBe(true);
  });

  it('retains workspace metadata when a pending stream is reconciled without persistence', () => {
    const stream: PendingAssistantStream = { taskId: 'task-1', turnId: 'turn-1', text: 'Saved D:\\session\\file.ts', createdAt, metadata: { projectRoot: 'D:\\project', executionCwd: 'D:\\session' } };
    const overlay = reconcilePendingAssistantStreams([], [stream]);

    expect(overlay[0]?.metadata).toMatchObject({ projectRoot: 'D:\\project', executionCwd: 'D:\\session' });
  });
});
