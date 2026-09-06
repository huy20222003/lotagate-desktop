export type DesktopExtensionKind = 'hook' | 'skill' | 'plugin' | 'mcp';
export type DesktopExtensionScope = 'user' | 'project' | 'plugin' | 'builtin';
export type DesktopHookEvent = 'session.start' | 'prompt.before' | 'tool.before' | 'tool.after' | 'response.after' | 'session.end';

export interface ExtensionDetailInput {
  kind: DesktopExtensionKind;
  cwd: string;
  name: string;
  scope?: DesktopExtensionScope | undefined;
  pluginName?: string | undefined;
  pluginScope?: 'user' | 'project' | undefined;
  sourceName?: string | undefined;
}

export interface ExtensionDetail {
  content: string;
  format: 'json' | 'markdown' | 'text';
  editable: boolean;
  fileName?: string;
}

export type PublicPluginContributionKind = 'skill' | 'mcp' | 'hook' | 'agent';

export interface PublicPluginCatalogContribution {
  kind: PublicPluginContributionKind;
  sourceName: string;
  description: string;
}

export interface PublicPluginCatalogEntry {
  directory: string;
  name: string;
  displayName?: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  privacyPolicy?: string;
  termsOfService?: string;
  icon?: string;
  contributions: readonly PublicPluginCatalogContribution[];
}

export interface PublicPluginContributionInput {
  pluginName: string;
  kind: 'skill' | 'mcp' | 'hook';
  sourceName: string;
}

export interface PluginIconInput {
  cwd: string;
  name: string;
  scope: 'user' | 'project';
}

export interface PluginIcon {
  mimeType: 'image/svg+xml';
  data: string;
}

export interface ExtensionDetailWriteInput extends ExtensionDetailInput {
  content: string;
}

export interface HookCreateInput {
  cwd: string;
  name: string;
  event: DesktopHookEvent;
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface HookRemoveInput {
  cwd: string;
  name: string;
}
