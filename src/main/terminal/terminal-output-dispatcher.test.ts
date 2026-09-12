import { describe, expect, it, vi } from 'vitest';
import { createTerminalOutputDispatcher, TerminalOutputDispatcher } from './terminal-output-dispatcher.js';

describe('TerminalOutputDispatcher', () => {
  it('coalesces bursts before forwarding them to the renderer', () => {
    vi.useFakeTimers();
    try {
      const sender = { isDestroyed: () => false, send: vi.fn() };
      const dispatcher = new TerminalOutputDispatcher(sender, 'session-1');
      dispatcher.push({ sessionId: 'session-1', data: 'first' });
      dispatcher.push({ sessionId: 'session-1', data: ' second' });

      expect(sender.send).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(sender.send).toHaveBeenCalledWith('terminal.output', { sessionId: 'session-1', data: 'first second' });
    } finally { vi.useRealTimers(); }
  });

  it('flushes buffered output once and ignores output after close', () => {
    const sender = { isDestroyed: () => false, send: vi.fn() };
    const dispatcher = new TerminalOutputDispatcher(sender, 'session-1');
    dispatcher.push({ sessionId: 'session-1', data: 'buffered' });
    dispatcher.close();
    dispatcher.push({ sessionId: 'session-1', data: 'ignored' });

    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send).toHaveBeenCalledWith('terminal.output', { sessionId: 'session-1', data: 'buffered' });
  });

  it('forwards the updated session id after the PTY session is created', () => {
    const sender = { isDestroyed: () => false, send: vi.fn() };
    const dispatcher = createTerminalOutputDispatcher(sender, 'pending');

    dispatcher.setSessionId('session-2');
    dispatcher.push({ sessionId: 'pending', data: 'prompt' });
    dispatcher.close();

    expect(sender.send).toHaveBeenCalledWith('terminal.output', { sessionId: 'session-2', data: 'prompt' });
  });
});
