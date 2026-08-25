import { describe, expect, it } from 'vitest';
import { parseDesktopEvent, parseDesktopResponse } from './desktop.js';

describe('Desktop JSONL contract', () => {
  it('parses a successful correlated response', () => {
    expect(parseDesktopResponse({ version: 1, id: 'request-1', type: 'response', method: 'initialize', ok: true, result: { version: 1 } })).toMatchObject({ id: 'request-1', ok: true });
  });

  it('parses an event without treating it as a response', () => {
    expect(parseDesktopEvent({ version: 1, type: 'event', event: 'assistant.delta', data: { content: 'hello' } })).toMatchObject({ event: 'assistant.delta' });
  });

  it('rejects unsupported protocol versions', () => {
    expect(() => parseDesktopResponse({ version: 2, id: 'request-1', type: 'response', method: 'initialize', ok: true })).toThrow();
  });
});
