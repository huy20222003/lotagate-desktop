import type { Task } from '../../../contracts/ipc/v1/workspace.js';

const MAX_SESSION_SLUG_LENGTH = 80;

export function sessionSlugFromPrompt(prompt: string): string {
  const firstMessage = prompt.replace(/\s+/gu, ' ').trim();
  if (!firstMessage) return 'New chat';
  return firstMessage.length > MAX_SESSION_SLUG_LENGTH
    ? `${firstMessage.slice(0, MAX_SESSION_SLUG_LENGTH - 1).trimEnd()}…`
    : firstMessage;
}

export function sessionSlug(task: Task): string {
  return task.title.trim() || 'New chat';
}
