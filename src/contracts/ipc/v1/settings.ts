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

export type SandboxBackend = 'auto' | 'docker' | 'podman' | 'disabled';
export type SandboxNetworkPolicy = 'none' | 'full';
export type SandboxMountMode = 'read-only' | 'read-write';
export type SandboxHostFallback = 'ask' | 'allow' | 'deny';
export type SandboxCleanupPolicy = 'always' | 'on-success';

export interface SandboxSettings {
  backend: SandboxBackend;
  image: string;
  networkPolicy: SandboxNetworkPolicy;
  mountMode: SandboxMountMode;
  memoryMb: number;
  cpuCores: number;
  pidsLimit: number;
  hostFallback: SandboxHostFallback;
  cleanup: SandboxCleanupPolicy;
  diagnosticsRetentionDays: number;
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
