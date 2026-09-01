import { useEffect, useRef } from 'react';
import type { Task } from '../../../contracts/ipc/v1/workspace.js';
import { formatTextClamp } from '../../utils/text.js';

const MAX_NOTIFICATION_BODY_LENGTH = 240;

export function useAgentResponseNotifications(tasks: Task[], activeTaskId?: string): void {
  const tasksRef = useRef(tasks);
  const activeTaskIdRef = useRef(activeTaskId);
  const responseByTurnRef = useRef(new Map<string, string>());
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { activeTaskIdRef.current = activeTaskId; }, [activeTaskId]);
  useEffect(() => window.lotagate.agent.onEvent(envelope => {
    const data = envelope.event.data;
    const turnId = typeof data['turnId'] === 'string' ? data['turnId'] : undefined;
    if (turnId === undefined) return;
    if (envelope.event.event === 'assistant.delta') {
      const content = typeof data['content'] === 'string' ? data['content'] : '';
      if (content.length > 0) responseByTurnRef.current.set(turnId, `${responseByTurnRef.current.get(turnId) ?? ''}${content}`);
      return;
    }
    if (!['turn.completed', 'turn.failed', 'turn.cancelled'].includes(envelope.event.event)) return;
    const task = findTask(tasksRef.current, data);
    const response = typeof data['content'] === 'string' ? data['content'] : responseByTurnRef.current.get(turnId) ?? '';
    responseByTurnRef.current.delete(turnId);
    if (task === undefined || !shouldNotify(task.id, activeTaskIdRef.current)) return;
    void window.lotagate.operations.notify(task.title, agentResponseNotification(response));
  }), []);
}

export function agentResponseNotification(response: string): string {
  const compact = response.replace(/\s+/gu, ' ').trim();
  if (compact.length === 0) return 'Agent response completed.';
  return formatTextClamp(MAX_NOTIFICATION_BODY_LENGTH, compact);
}

function findTask(tasks: Task[], data: Record<string, unknown>): Task | undefined {
  const taskId = typeof data['taskId'] === 'string' ? data['taskId'] : undefined;
  const sessionId = typeof data['sessionId'] === 'string' ? data['sessionId'] : undefined;
  return tasks.find(task => taskId !== undefined && task.id === taskId) ?? tasks.find(task => sessionId !== undefined && task.sessionId === sessionId);
}

function shouldNotify(taskId: string, activeTaskId: string | undefined): boolean {
  return taskId !== activeTaskId || document.visibilityState !== 'visible' || !document.hasFocus();
}
