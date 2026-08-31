export interface ModelUsageSummary { modelCode: string; totalTokens: number; totalRequests: number }
export interface ProfileSummary { workspaceCount: number; chatCount: number; lifetimeTokens: number; peakTokens: number; modelsUsed: number; dailyTokens: Map<string, number>; modelUsage: ModelUsageSummary[] }
