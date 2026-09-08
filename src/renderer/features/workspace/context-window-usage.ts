import type { Activity } from '../../../contracts/ipc/v1/workspace.js';

export interface ContextWindowUsage {
  usedTokens: number;
  contextWindow: number;
  model?: string;
}

export function contextUsageFromValue(value: unknown, contextWindow: number | undefined, model?: string): ContextWindowUsage | undefined {
  if (!isRecord(value)) return undefined;
  if (model !== undefined && typeof value['model'] === 'string' && value['model'] !== model) return undefined;
  const resolvedContextWindow = nonNegativeNumber(value['contextWindow']) ?? contextWindow;
  if (resolvedContextWindow === undefined) return undefined;
  const usage = value['usage'];
  if (!isRecord(usage)) return undefined;
  const usedTokens = nonNegativeNumber(usage['promptTokens']) ?? nonNegativeNumber(usage['totalTokens']);
  if (usedTokens === undefined) return undefined;
  return { usedTokens, contextWindow: resolvedContextWindow, ...(typeof value['model'] === 'string' ? { model: value['model'] } : {}) };
}

export function latestContextUsage(activities: readonly Activity[], contextWindow: number | undefined, model?: string): ContextWindowUsage | undefined {
  for (const activity of [...activities].reverse()) {
    if (activity.kind !== 'usage') continue;
    const usage = contextUsageFromValue(activity.metadata, contextWindow, model);
    if (usage !== undefined) return usage;
  }
  return undefined;
}

export function contextUsagePercent(usage: ContextWindowUsage): number {
  return Math.min(100, Math.max(0, Math.round((usage.usedTokens / usage.contextWindow) * 100)));
}

export function formatContextTokenCount(value: number): string {
  const normalized = Math.max(0, Math.round(value));
  if (normalized < 1_000) return String(normalized);
  if (normalized < 1_000_000) return `${trimTrailingZero(normalized / 1_000)}K`;
  if (normalized < 1_000_000_000) return `${trimTrailingZero(normalized / 1_000_000)}M`;
  return `${trimTrailingZero(normalized / 1_000_000_000)}B`;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function nonNegativeNumber(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : typeof value === 'string' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : undefined; }
function trimTrailingZero(value: number): string { return Number(value.toFixed(1)).toString(); }
