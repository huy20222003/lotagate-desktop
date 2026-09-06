import { describe, expect, it } from 'vitest';
import type { DesktopEvent } from '../../contracts/agent-protocol/v1/desktop.js';
import { TaskTurnCoordinator } from './task-turn-coordinator.js';

describe('TaskTurnCoordinator', () => {
  it('allows one owner and rejects a concurrent claim until the terminal event', () => {
    const coordinator = new TaskTurnCoordinator();
    const token = coordinator.claim('task-1', 'C:/workspace');
    expect(() => coordinator.claim('task-1', 'C:/workspace')).toThrow('already has a turn');
    coordinator.observe('task-1', { event: 'turn.completed', data: {}, version: 1, type: 'event', scope: 'session' } satisfies DesktopEvent);
    expect(() => coordinator.claim('task-1', 'C:/workspace')).not.toThrow();
    coordinator.release('task-1', token);
  });

  it('releases all claims owned by a workspace after process failure', () => {
    const coordinator = new TaskTurnCoordinator();
    coordinator.claim('task-1', 'C:/workspace');
    coordinator.claim('task-2', 'C:/other');
    coordinator.releaseWorkspace('C:/workspace');
    expect(() => coordinator.claim('task-1', 'C:/workspace')).not.toThrow();
    expect(() => coordinator.claim('task-2', 'C:/other')).toThrow();
  });

  it('does not release an unbound claim from a terminal event belonging to another session', () => {
    const coordinator = new TaskTurnCoordinator();
    const token = coordinator.claim('task-1', 'C:/workspace');

    coordinator.observe('task-1', { event: 'turn.completed', data: { sessionId: 'session-other' }, version: 1, type: 'event', scope: 'session' } satisfies DesktopEvent);

    expect(() => coordinator.claim('task-1', 'C:/workspace')).toThrow('already has a turn');
    coordinator.release('task-1', token);
  });

  it('releases a bound claim only from its owning session terminal event', () => {
    const coordinator = new TaskTurnCoordinator();
    const token = coordinator.claim('task-1', 'C:/workspace');
    coordinator.bind('task-1', token, 'session-a');

    coordinator.observe('task-1', { event: 'turn.failed', data: { sessionId: 'session-b' }, version: 1, type: 'event', scope: 'session' } satisfies DesktopEvent);
    expect(() => coordinator.claim('task-1', 'C:/workspace')).toThrow('already has a turn');
    coordinator.observe('task-1', { event: 'turn.failed', data: { sessionId: 'session-a' }, version: 1, type: 'event', scope: 'session' } satisfies DesktopEvent);
    expect(() => coordinator.claim('task-1', 'C:/workspace')).not.toThrow();
  });
});
