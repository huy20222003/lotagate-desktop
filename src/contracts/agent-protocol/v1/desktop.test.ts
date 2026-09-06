import { describe, expect, it } from 'vitest';
import { desktopRequestSchema, parseDesktopEvent, parseDesktopResponse } from './index.js';

describe('Desktop JSONL contract', () => {
  it('parses a successful correlated response', () => {
    expect(parseDesktopResponse({ version: 1, id: 'request-1', type: 'response', method: 'initialize', ok: true, result: { version: 1 } })).toMatchObject({ id: 'request-1', ok: true });
  });

  it('parses an event without treating it as a response', () => {
    expect(parseDesktopEvent({ version: 1, type: 'event', scope: 'session', event: 'assistant.delta', data: { content: 'hello' } })).toMatchObject({ event: 'assistant.delta' });
  });

  it('accepts the Desktop-only title generation request', () => {
    expect(desktopRequestSchema.parse({ version: 1, id: 'request-1', method: 'title.generate', params: { prompt: 'Summarize this request.' } })).toMatchObject({ method: 'title.generate' });
  });

  it('accepts extension requests forwarded to the CLI agent', () => {
    const methods = ['extension.listPublicPlugins', 'extension.resolvePublicPluginSource', 'extension.readPublicPluginContribution', 'extension.readDetail', 'extension.readPluginIcon'] as const;
    for (const method of methods) expect(desktopRequestSchema.parse({ version: 1, id: `request-${method}`, method, params: {} })).toMatchObject({ method });
  });

  it('derives the event scope when the installed CLI omits it', () => {
    expect(parseDesktopEvent({ version: 1, type: 'event', event: 'command.output', data: { content: 'hello' } })).toMatchObject({ scope: 'control' });
    expect(parseDesktopEvent({ version: 1, type: 'event', event: 'assistant.delta', data: { sessionId: 'session-1', content: 'hello' } })).toMatchObject({ scope: 'session' });
  });

  it('rejects unsupported protocol versions', () => {
    expect(() => parseDesktopResponse({ version: 2, id: 'request-1', type: 'response', method: 'initialize', ok: true })).toThrow();
  });
});
