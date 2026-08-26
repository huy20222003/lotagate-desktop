import type { AgentEventEnvelope } from '../../../contracts/ipc/v1/workspace.js';

export type ExtensionKind = 'hook' | 'skill' | 'plugin' | 'mcp';
export type ExtensionScope = 'user' | 'project' | 'builtin';

export interface ExtensionRow {
  name: string;
  status: string;
  detail: string;
  scope?: ExtensionScope;
  editable?: boolean;
}

export interface CommandInvocation {
  actionId: string;
  positionals: string[];
  options: Record<string, string | boolean>;
}

const LIST_ACTIONS: Record<ExtensionKind, string> = { hook: 'hook.list', skill: 'skill.list', plugin: 'plugin.list', mcp: 'mcp.list' };

export class ExtensionCommandClient {
  async listCommands(cwd: string): Promise<Set<string>> {
    const result = await window.lotagate.agent.commandList(cwd);
    if (typeof result !== 'object' || result === null) return new Set();
    const commands = (result as Record<string, unknown>)['commands'];
    if (!Array.isArray(commands)) return new Set();
    return new Set(commands.flatMap(command => {
      if (typeof command !== 'object' || command === null) return [];
      const id = (command as Record<string, unknown>)['id'];
      return typeof id === 'string' ? [id] : [];
    }));
  }

  async list(cwd: string, kind: ExtensionKind): Promise<ExtensionRow[]> {
    const output = await this.execute(cwd, { actionId: LIST_ACTIONS[kind], positionals: [], options: {} });
    const rows = parseExtensionRows(output, kind);
    if (kind !== 'hook') return rows;
    const projectHooks = new Set(await window.lotagate.extensions.listProjectHooks(cwd));
    return rows.map(row => ({ ...row, editable: projectHooks.has(row.name) }));
  }

  async execute(cwd: string, invocation: CommandInvocation): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let commandId: string | undefined;
      let output = '';
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const buffered = new Map<string, AgentEventEnvelope[]>();
      const dispose = window.lotagate.agent.onEvent(envelope => {
        const event = envelope.event.event;
        if (envelope.cwd !== cwd || !event.startsWith('command.')) return;
        const eventCommandId = readString(envelope.event.data['commandId']);
        if (eventCommandId === undefined) return;
        const events = buffered.get(eventCommandId) ?? [];
        events.push(envelope);
        buffered.set(eventCommandId, events);
        if (commandId === eventCommandId) drain();
      });
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        dispose();
        if (timer !== undefined) clearTimeout(timer);
        if (error) reject(error);
        else resolve(output);
      };
      const drain = () => {
        if (commandId === undefined) return;
        const events = buffered.get(commandId) ?? [];
        buffered.delete(commandId);
        for (const envelope of events) {
          const event = envelope.event.event;
          const data = envelope.event.data;
          if (event === 'command.output') output += readString(data['content']) ?? '';
          if (event === 'command.completed') {
            const exitCode = data['exitCode'];
            if (typeof exitCode === 'number' && exitCode !== 0) finish(new Error(output.trim() || `Command exited with code ${exitCode}.`));
            else finish();
          }
          if (event === 'command.failed') finish(new Error((readErrorMessage(data['error']) ?? output.trim()) || 'Command failed.'));
          if (event === 'command.cancelled') finish(new Error('Command was cancelled.'));
        }
      };
      void window.lotagate.agent.commandExecute(cwd, invocation as unknown as Record<string, unknown>).then(value => {
        commandId = readAcceptedCommandId(value);
        if (commandId === undefined) { finish(new Error('The CLI did not return a command id.')); return; }
        drain();
      }).catch(reason => finish(toError(reason)));
      timer = setTimeout(() => finish(new Error('The command timed out.')), 120_000);
    });
  }
}

export function parseExtensionRows(output: string, kind: ExtensionKind): ExtensionRow[] {
  return output.split(/\r?\n/u).flatMap(line => {
    if (!line.trim() || /^Name\s{2,}Status\s{2,}Detail$/u.test(line.trim()) || /^No /u.test(line.trim())) return [];
    const match = /^(.*?)\s{2,}(\S+)\s{2,}(.*)$/u.exec(line.trimEnd());
    if (!match) return [];
    const name = match[1]?.trim();
    const status = match[2]?.trim();
    const detail = match[3]?.trim();
    if (!name || !status || detail === undefined) return [];
    const scope = kind === 'hook' ? undefined : readScope(detail);
    return [{ name, status, detail, ...(scope === undefined ? {} : { scope }) }];
  });
}

function readAcceptedCommandId(value: unknown): string | undefined { return typeof value === 'object' && value !== null ? readString((value as Record<string, unknown>)['commandId']) : undefined; }
function readString(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
function readScope(detail: string): ExtensionScope | undefined { const scope = detail.split(' · ', 1)[0]; return scope === 'user' || scope === 'project' || scope === 'builtin' ? scope : undefined; }
function readErrorMessage(value: unknown): string | undefined { return typeof value === 'object' && value !== null ? readString((value as Record<string, unknown>)['message']) : readString(value); }
function toError(reason: unknown): Error { return reason instanceof Error ? reason : new Error('The command failed.'); }
