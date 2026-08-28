import { describe, expect, it } from 'vitest';
import { MessageQueueService } from './message-queue-service.js';

describe('MessageQueueService', () => {
  it('keeps insertion order and supports taking the next message', () => {
    const service = new MessageQueueService();
    const first = service.enqueue('first', [{ id: 'file-1', name: 'a.pdf', kind: 'binary', size: 10 }]);
    service.enqueue('second');

    expect(service.snapshot().map(item => item.prompt)).toEqual(['first', 'second']);
    expect(service.snapshot()[0]?.attachments.map(item => item.id)).toEqual(['file-1']);
    expect(service.takeFirst()?.id).toBe(first.id);
    expect(service.snapshot().map(item => item.prompt)).toEqual(['second']);
  });

  it('removes only the selected message', () => {
    const service = new MessageQueueService();
    service.enqueue('first');
    const second = service.enqueue('second');

    expect(service.remove(second.id)?.prompt).toBe('second');
    expect(service.snapshot().map(item => item.prompt)).toEqual(['first']);
  });

  it('can restore a failed message ahead of the remaining queue', () => {
    const service = new MessageQueueService();
    const first = service.enqueue('first');
    service.enqueue('second');

    expect(service.takeFirst()?.id).toBe(first.id);
    service.prepend(first);

    expect(service.snapshot().map(item => item.prompt)).toEqual(['first', 'second']);
  });

  it('keeps skill invocation metadata when a prompt is queued', () => {
    const service = new MessageQueueService();
    const message = service.enqueue('/review Check the diff', [], { skills: ['review'], agentPrompt: 'Use the selected skill "review" for this request.' });

    expect(message.options).toEqual({ skills: ['review'], agentPrompt: 'Use the selected skill "review" for this request.' });
  });
});
