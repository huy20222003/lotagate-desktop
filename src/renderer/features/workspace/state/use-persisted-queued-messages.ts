import { useEffect, useRef } from 'react';
import type { Task } from '../../../../contracts/ipc/v1/workspace.js';
import { toQueuedMessage } from './workspace-controller-helpers.js';
import type { MessageQueueService } from './message-queue-service.js';

export function usePersistedQueuedMessages(task: Task | undefined, service: MessageQueueService): void {
  const requestRef = useRef(0);
  useEffect(() => {
    const requestId = ++requestRef.current;
    const taskId = task?.id;
    if (taskId === undefined) { service.clear(); return; }
    void window.lotagate.tasks.queuedPrompts(taskId).then(async queued => {
      const messages = await Promise.all(queued.map(prompt => toQueuedMessage(taskId, prompt)));
      if (requestId === requestRef.current) service.replace(messages);
    }).catch(() => undefined);
  }, [service, task?.id]);
}
