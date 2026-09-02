import { describe, expect, it } from 'vitest';
import { allowsUnscopedTaskFallback } from './agent-event-routing.js';

describe('allowsUnscopedTaskFallback', () => {
  it('does not route background command events to the selected conversation', () => {
    expect(allowsUnscopedTaskFallback('command.started', undefined, undefined)).toBe(false);
    expect(allowsUnscopedTaskFallback('command.activity.started', undefined, undefined)).toBe(false);
  });

  it('keeps unscoped agent events associated with a single active task', () => {
    expect(allowsUnscopedTaskFallback('tool.started', undefined, undefined)).toBe(true);
    expect(allowsUnscopedTaskFallback('turn.started', undefined, undefined)).toBe(true);
    expect(allowsUnscopedTaskFallback('turn.started', 'session-id', undefined)).toBe(false);
  });
});
