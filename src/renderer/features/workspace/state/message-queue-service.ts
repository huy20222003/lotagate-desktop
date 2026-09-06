import { useSyncExternalStore } from 'react';
import type { AttachmentPreview } from '../../../services/attachment-types.js';
import type { PromptSendOptions } from '../composer/prompt-options.js';

export interface QueuedMessage {
  id: string;
  taskId?: string;
  prompt: string;
  options?: PromptSendOptions;
  attachments: readonly AttachmentPreview[];
  createdAt: number;
}

export class MessageQueueService {
  private messages: QueuedMessage[] = [];
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  snapshot = (): readonly QueuedMessage[] => this.messages;

  enqueue(prompt: string, attachments: readonly AttachmentPreview[] = [], options?: PromptSendOptions, taskId?: string, id?: string, createdAt?: number): QueuedMessage {
    const message = { id: id ?? crypto.randomUUID(), ...(taskId === undefined ? {} : { taskId }), prompt, ...(options === undefined ? {} : { options }), attachments: [...attachments], createdAt: createdAt ?? Date.now() };
    this.messages = [...this.messages, message];
    this.notify();
    return message;
  }

  replace(messages: readonly QueuedMessage[]): void { this.messages = [...messages]; this.notify(); }

  peekFirst(): QueuedMessage | undefined { return this.messages[0]; }

  prepend(message: QueuedMessage): void {
    this.messages = [message, ...this.messages.filter(item => item.id !== message.id)];
    this.notify();
  }

  remove(id: string): QueuedMessage | undefined {
    const message = this.messages.find(item => item.id === id);
    if (!message) return undefined;
    this.messages = this.messages.filter(item => item.id !== id);
    this.notify();
    return message;
  }

  takeFirst(): QueuedMessage | undefined {
    const message = this.messages[0];
    if (!message) return undefined;
    this.messages = this.messages.slice(1);
    this.notify();
    return message;
  }

  clear(): void { if (this.messages.length === 0) return; this.messages = []; this.notify(); }
  private notify(): void { for (const listener of this.listeners) listener(); }
}

export function useMessageQueue(service: MessageQueueService): readonly QueuedMessage[] {
  return useSyncExternalStore(service.subscribe, service.snapshot, service.snapshot);
}
