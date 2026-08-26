import type { Task } from '../../../contracts/ipc/v1/workspace.js';
import { formatTextClamp } from '../../utils/text.js';

const MAX_SESSION_SLUG_LENGTH = 80;

export function sessionSlugFromPrompt(prompt: string): string {
  const firstMessage = prompt.replace(/\s+/gu, ' ').trim();
  if (!firstMessage) return 'New chat';
  return formatTextClamp(MAX_SESSION_SLUG_LENGTH - 4, firstMessage);
}

export function sessionSlug(task: Task): string {
  return task.title.trim() || 'New chat';
}
