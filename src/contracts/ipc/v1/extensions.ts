export type DesktopExtensionKind = 'hook' | 'skill' | 'plugin' | 'mcp';
export type DesktopExtensionScope = 'user' | 'project' | 'plugin' | 'builtin';
export type DesktopHookEvent = 'session.start' | 'prompt.before' | 'tool.before' | 'tool.after' | 'response.after' | 'session.end';

export interface ExtensionDetailInput {
  kind: DesktopExtensionKind;
  cwd: string;
  name: string;
  scope?: DesktopExtensionScope | undefined;
}

export interface ExtensionDetail {
  content: string;
  format: 'json' | 'markdown' | 'text';
  editable: boolean;
  fileName?: string;
}

export interface ExtensionDetailWriteInput extends ExtensionDetailInput {
  content: string;
}

export interface HookCreateInput {
  cwd: string;
  event: DesktopHookEvent;
  command: string;
  args: string[];
  timeoutMs: number;
}

export interface HookRemoveInput {
  cwd: string;
  name: string;
}
