export type McpDisplayStatus = 'connecting' | 'connected' | 'failed' | 'disconnected';

export interface McpRuntimeStatus {
  status: McpDisplayStatus;
  latencyMs?: number;
  toolCount?: number;
  error?: string;
  updatedAt: number;
}

export function isMcpDisplayStatus(value: unknown): value is McpDisplayStatus {
  return value === 'connecting' || value === 'connected' || value === 'failed' || value === 'disconnected';
}
