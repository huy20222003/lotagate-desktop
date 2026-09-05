// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../../contracts/ipc/v1/workspace.js';
import { formatTextClamp } from '../../../utils/text.js';
import { agentResponseNotification, useAgentResponseNotifications } from './use-agent-response-notifications.js';

const task = { id: 'task-1', title: 'Research session', sessionId: 'session-1' } as Task;

describe('useAgentResponseNotifications', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('notifies with the session title and response when another session completes', () => {
    let listener: ((envelope: { event: { event: string; data: Record<string, unknown> } }) => void) | undefined;
    const notify = vi.fn();
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { agent: { onEvent: vi.fn(callback => { listener = callback; return () => undefined; }) }, operations: { notify } } });
    renderHook(() => useAgentResponseNotifications([task], 'other-task'));

    act(() => listener?.({ event: { event: 'turn.completed', data: { taskId: task.id, turnId: 'turn-1', content: 'The workspace check is complete.' } } }));

    expect(notify).toHaveBeenCalledWith('Research session', 'The workspace check is complete.');
  });

  it('waits for task synchronization when the terminal event arrives first', () => {
    const notify = vi.fn();
    let listener: ((envelope: { event: { event: string; data: Record<string, unknown> } }) => void) | undefined;
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { agent: { onEvent: vi.fn(callback => { listener = callback; return () => undefined; }) }, operations: { notify } } });
    const view = renderHook(({ tasks }) => useAgentResponseNotifications(tasks, 'other-task'), { initialProps: { tasks: [] as Task[] } });

    act(() => listener?.({ event: { event: 'turn.completed', data: { sessionId: task.sessionId, turnId: 'turn-1', content: 'The background session is complete.' } } }));
    expect(notify).not.toHaveBeenCalled();

    act(() => view.rerender({ tasks: [task] }));
    expect(notify).toHaveBeenCalledWith('Research session', 'The background session is complete.');
  });

  it('does not notify for the focused active session', () => {
    const notify = vi.fn();
    let listener: ((envelope: { event: { event: string; data: Record<string, unknown> } }) => void) | undefined;
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { agent: { onEvent: vi.fn(callback => { listener = callback; return () => undefined; }) }, operations: { notify } } });
    renderHook(() => useAgentResponseNotifications([task], task.id));

    act(() => listener?.({ event: { event: 'turn.completed', data: { taskId: task.id, turnId: 'turn-1', content: 'Done.' } } }));

    expect(notify).not.toHaveBeenCalled();
  });

  it('uses the currently displayed title without waiting for title generation', () => {
    const notify = vi.fn();
    let listener: ((envelope: { cwd: string; event: { event: string; data: Record<string, unknown> } }) => void) | undefined;
    const automaticTask = { ...task, cwd: 'C:\\workspace', title: 'Initial prompt', titleSource: 'automatic', titleSummaryStatus: 'generating' } as Task;
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { agent: { onEvent: vi.fn(callback => { listener = callback; return () => undefined; }) }, operations: { notify } } });
    const view = renderHook(({ tasks }) => useAgentResponseNotifications(tasks, 'other-task'), { initialProps: { tasks: [automaticTask] } });

    act(() => listener?.({ cwd: automaticTask.cwd, event: { event: 'turn.completed', data: { taskId: automaticTask.id, turnId: 'turn-1', content: '**Finished**' } } }));
    expect(notify).toHaveBeenCalledWith('Initial prompt', 'Finished');

    act(() => view.rerender({ tasks: [{ ...automaticTask, title: 'Generated session title', titleSummaryStatus: 'completed' } as Task] }));
    expect(notify).toHaveBeenCalledOnce();
  });
});

describe('agentResponseNotification', () => {
  it('compacts and bounds response text', () => {
    expect(agentResponseNotification('  first\nsecond  ')).toBe('first second');
    expect(agentResponseNotification('x'.repeat(300))).toBe(formatTextClamp(240, 'x'.repeat(300)));
    expect(agentResponseNotification('')).toBe('Agent response completed.');
    expect(agentResponseNotification('**Bold** and `code` with [a link](https://example.com).')).toBe('Bold and code with a link.');
  });
});
