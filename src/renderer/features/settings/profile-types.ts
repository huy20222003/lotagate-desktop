export interface ProfileSummary { workspaceCount: number; chatCount: number; lifetimeTokens: number; peakTokens: number; modelsUsed: number; dailyTokens: Map<string, number> }
