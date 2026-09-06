import { useEffect, useRef } from 'react';
import type { Task } from '../../../../contracts/ipc/v1/workspace.js';
import { formatTextClamp } from '../../../utils/text.js';

const MAX_NOTIFICATION_BODY_LENGTH = 240;
type TaskEventIdentity = { taskId?: string; sessionId?: string };
type PendingNotification = TaskEventIdentity & { cwd?: string; response: string };

export function useAgentResponseNotifications(tasks: Task[], activeTaskId?: string): void {
  const tasksRef = useRef(tasks);
  const activeTaskIdRef = useRef(activeTaskId);
  const responseByTurnRef = useRef(new Map<string, string>());
  const pendingNotificationsRef = useRef(new Map<string, PendingNotification>());
  tasksRef.current = tasks;
  activeTaskIdRef.current = activeTaskId;
  useEffect(() => {
    for (const [turnId, pending] of pendingNotificationsRef.current) {
      const task = findTask(tasks, pending, pending.cwd);
      if (task === undefined) continue;
      pendingNotificationsRef.current.delete(turnId);
      notifyTask(task, pending.response, activeTaskIdRef.current);
    }
  }, [tasks]);
  useEffect(() => window.lotagate.agent.onEvent(envelope => {
    const data = envelope.event.data;
    const turnId = typeof data['turnId'] === 'string' ? data['turnId'] : undefined;
    if (turnId === undefined) return;
    if (envelope.event.event === 'assistant.delta') {
      const content = typeof data['content'] === 'string' ? data['content'] : '';
      if (content.length > 0) responseByTurnRef.current.set(turnId, `${responseByTurnRef.current.get(turnId) ?? ''}${content}`);
      return;
    }
    if (envelope.event.event === 'assistant.replaced') {
      const content = typeof data['content'] === 'string' ? data['content'] : '';
      responseByTurnRef.current.set(turnId, content);
      return;
    }
    if (!['turn.completed', 'turn.failed', 'turn.cancelled'].includes(envelope.event.event)) return;
    const task = findTask(tasksRef.current, data, envelope.cwd);
    const response = typeof data['content'] === 'string' ? data['content'] : responseByTurnRef.current.get(turnId) ?? '';
    responseByTurnRef.current.delete(turnId);
    if (task === undefined) {
      pendingNotificationsRef.current.set(turnId, {
        ...(typeof data['taskId'] === 'string' ? { taskId: data['taskId'] } : {}),
        ...(typeof data['sessionId'] === 'string' ? { sessionId: data['sessionId'] } : {}),
        ...(envelope.cwd === undefined ? {} : { cwd: envelope.cwd }),
        response,
      });
      return;
    }
    notifyTask(task, response, activeTaskIdRef.current);
  }), []);
}

export function agentResponseNotification(response: string): string {
  const compact = stripNotificationMarkdown(response).replace(/\s+/gu, ' ').trim();
  if (compact.length === 0) return 'Agent response completed.';
  return formatTextClamp(MAX_NOTIFICATION_BODY_LENGTH, compact);
}

function notifyTask(task: Task, response: string, activeTaskId: string | undefined): void {
  if (!shouldNotify(task.id, activeTaskId)) return;
  void Promise.resolve(window.lotagate.operations.notify(task.title, agentResponseNotification(response))).catch(() => undefined);
}

function findTask(tasks: Task[], data: TaskEventIdentity | Record<string, unknown>, cwd?: string): Task | undefined {
  const taskId = typeof data.taskId === 'string' ? data.taskId : typeof data['taskId'] === 'string' ? data['taskId'] : undefined;
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : typeof data['sessionId'] === 'string' ? data['sessionId'] : undefined;
  return tasks.find(task => taskId !== undefined && task.id === taskId && (cwd === undefined || task.cwd === cwd)) ?? tasks.find(task => sessionId !== undefined && task.sessionId === sessionId && (cwd === undefined || task.cwd === cwd));
}

function shouldNotify(taskId: string, activeTaskId: string | undefined): boolean {
  return taskId !== activeTaskId || document.visibilityState !== 'visible' || !document.hasFocus();
}

export function stripNotificationMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/```(?:[A-Za-z0-9_+-]+)?/gu, '')
    .replace(/[`*_~]/gu, '')
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]>)\s*/gmu, '')
    .replace(/^\s*>\s?/gmu, '')
    .replace(/^\s*[-*+]\s+/gmu, '')
    .replace(/^\s*\d+[.)]\s+/gmu, '')
    .replace(/<[^>]+>/gu, '');
}
