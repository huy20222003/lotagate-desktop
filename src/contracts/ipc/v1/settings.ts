import { z } from 'zod';

export type ApprovalMode = 'auto' | 'ask';
export type TerminalShell = 'powershell' | 'cmd' | 'git-bash';
export type TerminalPlacement = 'bottom' | 'right';
export const fileOpenDestinationSchema = z.enum(['vscode', 'file-explorer']);
export type FileOpenDestination = z.infer<typeof fileOpenDestinationSchema>;
export const DEFAULT_FILE_OPEN_DESTINATION: FileOpenDestination = 'file-explorer';

export type BrowserViewportProfile = 'desktop' | 'laptop' | 'tablet' | 'mobile' | 'custom';
export type BrowserSessionRetention = 'session' | 'persistent' | 'ttl';

export interface BrowserViewportSettings {
  width: number;
  height: number;
  mobile: boolean;
  deviceScaleFactor: number;
}

export interface BrowserSettings {
  viewportProfile: BrowserViewportProfile;
  customViewport: BrowserViewportSettings;
  downloadDirectory: string;
  sessionRetention: BrowserSessionRetention;
  sessionRetentionMinutes: number;
  originAllowlist: string[];
  clearDataOnClose: boolean;
  evidenceRetentionDays: number;
}

export interface ComputerSettings {
  applicationAllowlist: string[];
}

export type SandboxRuntime = 'auto' | 'wsl2' | 'disabled';
export type SandboxNetworkPolicy = 'none' | 'allowlist' | 'full';
export type SandboxWorkspaceAccess = 'read-only' | 'read-write';
export type SandboxHostFallback = 'ask' | 'allow' | 'deny';

export const SANDBOX_DEFAULTS = {
  runtime: 'auto',
  distribution: 'LotaGate-VM',
  profile: 'general',
  networkPolicy: 'none',
  allowedDomains: [],
  workspaceAccess: 'read-write',
  memoryMb: 2_048,
  cpuCores: 2,
  pidsLimit: 128,
  diskMb: 8_192,
  maxConcurrentEnvironments: 2,
  maxConcurrentOperations: 8,
  idleTimeoutMinutes: 15,
  hostFallback: 'ask',
  diagnosticsRetentionDays: 30,
} as const;

export const SANDBOX_LIMITS = {
  memoryMb: { min: 128, max: 16_384 },
  cpuCores: { min: 0.25, max: 16 },
  pidsLimit: { min: 16, max: 4_096 },
  diskMb: { min: 1_024, max: 131_072 },
  maxConcurrentEnvironments: { min: 1, max: 32 },
  maxConcurrentOperations: { min: 1, max: 128 },
  idleTimeoutMinutes: { min: 1, max: 24 * 60 },
  diagnosticsRetentionDays: { min: 1, max: 365 },
} as const;

export interface SandboxSettings {
  runtime: SandboxRuntime;
  distribution: string;
  profile: 'general';
  networkPolicy: SandboxNetworkPolicy;
  allowedDomains: string[];
  workspaceAccess: SandboxWorkspaceAccess;
  memoryMb: number;
  cpuCores: number;
  pidsLimit: number;
  diskMb: number;
  maxConcurrentEnvironments: number;
  maxConcurrentOperations: number;
  idleTimeoutMinutes: number;
  hostFallback: SandboxHostFallback;
  diagnosticsRetentionDays: number;
}

export type SandboxHealthState = 'disabled' | 'ready' | 'degraded' | 'unavailable';

export interface SandboxRuntimeHealth {
  runtime: 'wsl2' | 'bubblewrap' | 'seatbelt' | 'unsupported';
  available: boolean;
  distribution: string;
  restartRequired?: boolean;
  adminRequired?: boolean;
  resourceQuota?: 'cgroup' | 'process';
  reason?: string;
}

export interface SandboxDependencyHealth {
  profile: SandboxSettings['profile'];
  available: boolean;
  statuses: Array<{ id: string; label: string; installed: boolean; installable: boolean; reason?: string }>;
  installed: string[];
  missing: string[];
  manual: string[];
  failed: string[];
}

export interface SandboxHealthSnapshot {
  state: SandboxHealthState;
  runtime: SandboxRuntimeHealth;
  dependencies: SandboxDependencyHealth;
  checkedAt: string;
}

export interface DesktopSettingsSnapshot {
  appearance: 'system' | 'light' | 'dark';
  language: 'en' | 'vi';
  reducedMotion: boolean;
  contrast: number;
  uiFont: 'inter' | 'system' | 'mono';
  codeFont: 'inter' | 'system' | 'mono';
  accentColor?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  defaultModel?: string;
  executionPolicy: 'ask' | 'allowlist' | 'review' | 'autonomous';
  approvalMode: ApprovalMode;
  browser: BrowserSettings;
  computer: ComputerSettings;
  sandbox: SandboxSettings;
  notifications: boolean;
  telemetry: boolean;
  keyboardShortcuts: Record<string, string | null>;
  terminalShell: TerminalShell;
  terminalPlacement: TerminalPlacement;
  terminalFontSize: number;
  terminalScrollback: number;
  terminalCursorBlink: boolean;
  defaultFileOpenDestination: FileOpenDestination;
  showContextWindowUsage: boolean;
}
