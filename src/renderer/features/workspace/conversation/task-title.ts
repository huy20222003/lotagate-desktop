import type { Task } from '../../../../contracts/ipc/v1/workspace.js';
import { takeWords } from '../../../utils/text.js';

const MAX_SESSION_SLUG_LENGTH = 80;

export function sessionSlugFromPrompt(prompt: string): string {
  const firstMessage = prompt.replace(/\s+/gu, ' ').trim();
  if (!firstMessage) return 'New chat';
  const firstSentence = firstMessage.split(/(?<=[.!?])\s+/u, 1)[0] ?? firstMessage;
  if (firstSentence.length <= MAX_SESSION_SLUG_LENGTH) return firstSentence;
  return takeWords(MAX_SESSION_SLUG_LENGTH, firstSentence).slice(0, MAX_SESSION_SLUG_LENGTH).trimEnd();
}

export function sessionSlug(task: Task): string {
  return task.title.trim() || 'New chat';
}
