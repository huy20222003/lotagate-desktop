import type { AgentEventEnvelope } from '../../contracts/ipc/v1/workspace.js';

export interface DesktopCommandInvocation {
  actionId: string;
  positionals: string[];
  options: Record<string, string | boolean>;
}

export interface DesktopCommandDescriptor {
  id: string;
  path: string[];
  summary: string;
  arguments?: Array<{ name: string; required: boolean; variadic?: boolean }>;
  options?: Array<{ name: string; valueName?: string; description: string; required?: boolean; allowedValues?: string[] }>;
}

export async function listDesktopCommands(cwd: string): Promise<DesktopCommandDescriptor[]> {
  const result = await window.lotagate.agent.commandList(cwd);
  if (typeof result !== 'object' || result === null) return [];
  const commands = (result as Record<string, unknown>)['commands'];
  if (!Array.isArray(commands)) return [];
  return commands.flatMap(parseCommandDescriptor);
}

export function executeDesktopCommand(cwd: string, invocation: DesktopCommandInvocation): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let commandId: string | undefined;
    let output = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const buffered = new Map<string, AgentEventEnvelope[]>();
    const dispose = window.lotagate.agent.onEvent(envelope => {
      if (envelope.cwd !== cwd || !envelope.event.event.startsWith('command.')) return;
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

function parseCommandDescriptor(value: unknown): DesktopCommandDescriptor[] {
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  if (typeof record['id'] !== 'string' || !Array.isArray(record['path']) || record['path'].some(item => typeof item !== 'string') || typeof record['summary'] !== 'string') return [];
  const argumentsValue = parseArguments(record['arguments']).arguments;
  const optionsValue = parseOptions(record['options']).options;
  return [{ id: record['id'], path: record['path'] as string[], summary: record['summary'], ...(argumentsValue === undefined ? {} : { arguments: argumentsValue }), ...(optionsValue === undefined ? {} : { options: optionsValue }) }];
}

function parseArguments(value: unknown): { arguments?: DesktopCommandDescriptor['arguments'] } {
  if (!Array.isArray(value)) return {};
  const argumentsList = value.flatMap(item => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    return typeof record['name'] === 'string' && typeof record['required'] === 'boolean' ? [{ name: record['name'], required: record['required'], ...(typeof record['variadic'] === 'boolean' ? { variadic: record['variadic'] } : {}) }] : [];
  });
  return argumentsList.length === value.length ? { arguments: argumentsList } : {};
}

function parseOptions(value: unknown): { options?: DesktopCommandDescriptor['options'] } {
  if (!Array.isArray(value)) return {};
  const optionsList = value.flatMap(item => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    const allowedValues = record['allowedValues'];
    return typeof record['name'] === 'string' && typeof record['description'] === 'string' ? [{ name: record['name'], description: record['description'], ...(typeof record['valueName'] === 'string' ? { valueName: record['valueName'] } : {}), ...(typeof record['required'] === 'boolean' ? { required: record['required'] } : {}), ...(Array.isArray(allowedValues) && allowedValues.every(item => typeof item === 'string') ? { allowedValues: allowedValues as string[] } : {}) }] : [];
  });
  return optionsList.length === value.length ? { options: optionsList } : {};
}

function readAcceptedCommandId(value: unknown): string | undefined { return typeof value === 'object' && value !== null ? readString((value as Record<string, unknown>)['commandId']) : undefined; }
function readString(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
function readErrorMessage(value: unknown): string | undefined { return typeof value === 'object' && value !== null ? readString((value as Record<string, unknown>)['message']) : readString(value); }
function toError(reason: unknown): Error { return reason instanceof Error ? reason : new Error('The command failed.'); }
