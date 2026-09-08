import { describe, expect, it } from 'vitest';
import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
import { contextUsageFromValue, contextUsagePercent, formatContextTokenCount, latestContextUsage } from './context-window-usage.js';

describe('context window usage', () => {
  it('reads prompt tokens from a usage event and keeps the model identity', () => {
    expect(contextUsageFromValue({ model: 'model-1', usage: { promptTokens: 187_000, totalTokens: 188_200 } }, 258_000, 'model-1')).toEqual({ model: 'model-1', usedTokens: 187_000, contextWindow: 258_000 });
  });

  it('ignores usage from another selected model', () => {
    expect(contextUsageFromValue({ model: 'model-1', usage: { promptTokens: 10 } }, 100, 'model-2')).toBeUndefined();
  });

  it('uses the context window sent by the CLI when the catalog fallback is unavailable', () => {
    expect(contextUsageFromValue({ contextWindow: 1_000_000, usage: { promptTokens: 12_345 } }, undefined)).toEqual({ usedTokens: 12_345, contextWindow: 1_000_000 });
  });

  it('restores the most recent matching usage activity', () => {
    const activities = [
      { kind: 'usage', metadata: { model: 'model-1', usage: { promptTokens: 12 } } },
      { kind: 'usage', metadata: { model: 'model-1', usage: { promptTokens: 42 } } },
    ] as unknown as Activity[];
    expect(latestContextUsage(activities, 100, 'model-1')).toEqual({ model: 'model-1', usedTokens: 42, contextWindow: 100 });
  });

  it('formats the percentage and compact token labels for the indicator', () => {
    expect(contextUsagePercent({ usedTokens: 187_000, contextWindow: 258_000 })).toBe(72);
    expect(formatContextTokenCount(187_000)).toBe('187K');
    expect(formatContextTokenCount(258_000)).toBe('258K');
    expect(formatContextTokenCount(1_000_000)).toBe('1M');
    expect(formatContextTokenCount(1_000_000_000)).toBe('1B');
  });
});
