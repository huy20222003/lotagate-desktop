import type { DesktopHookEvent } from '../../../contracts/ipc/v1/extensions.js';
import type { CommandInvocation, ExtensionKind, ExtensionRow } from './extension-command-client.js';

export type ValidationErrors = Record<string, string | undefined>;
export const hookEventOptions = ['session.start', 'prompt.before', 'tool.before', 'tool.after', 'response.after', 'session.end'].map(value => ({ value, label: value }));
export const scopeOptions = [{ value: 'user', label: 'User' }, { value: 'project', label: 'Project' }];
export interface HookAddValue { name: string; event: DesktopHookEvent; command: string; args: string[]; timeoutMs: number }
export interface ExtensionAddValue { invocation: CommandInvocation; message: string }
export interface ExtensionRowViewProps { row: ExtensionRow; busy: boolean; readOnly: boolean; canToggle: boolean; canRemove: boolean; onOpen: () => void; onToggle: () => void; onRemove: () => void }
export type EditableExtensionKind = Exclude<ExtensionKind, 'hook'>;
