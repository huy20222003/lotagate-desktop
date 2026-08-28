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

export interface DesktopCommandResult {
  content: string;
  structured?: Record<string, unknown>;
}

const COMMAND_LIST_TIMEOUT_MS = 15_000;

export async function listDesktopCommands(cwd: string): Promise<DesktopCommandDescriptor[]> {
  const result = await withTimeout(window.lotagate.agent.commandList(cwd), COMMAND_LIST_TIMEOUT_MS, 'Loading Desktop commands timed out.');
  if (typeof result !== 'object' || result === null) return [];
  const commands = (result as Record<string, unknown>)['commands'];
  if (!Array.isArray(commands)) return [];
  return commands.flatMap(parseCommandDescriptor);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(value => { clearTimeout(timer); resolve(value); }, reason => { clearTimeout(timer); reject(reason); });
  });
}

export function findDesktopCommand(commands: readonly DesktopCommandDescriptor[], path: readonly string[]): DesktopCommandDescriptor | undefined {
  return commands.find(command => command.path.length === path.length && command.path.every((part, index) => part === path[index]));
}

export function executeDesktopCommand(cwd: string, invocation: DesktopCommandInvocation): Promise<string> {
  return executeDesktopCommandResult(cwd, invocation).then(result => result.content);
}

export function executeDesktopCommandResult(cwd: string, invocation: DesktopCommandInvocation): Promise<DesktopCommandResult> {
  return new Promise<DesktopCommandResult>((resolve, reject) => {
    let commandId: string | undefined;
    let output = '';
    let structured: Record<string, unknown> | undefined;
    let settled = false;
    let cancellationRequested = false;
    let timedOut = false;
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
      else resolve({ content: output, ...(structured === undefined ? {} : { structured }) });
    };
    const requestCancellation = () => {
      if (cancellationRequested || commandId === undefined) return;
      cancellationRequested = true;
      void window.lotagate.agent.commandCancel(cwd, commandId).catch(() => undefined);
    };
    const drain = () => {
      if (commandId === undefined) return;
      const events = buffered.get(commandId) ?? [];
      buffered.delete(commandId);
      for (const envelope of events) {
        const event = envelope.event.event;
        const data = envelope.event.data;
        if (event === 'command.output') {
          output += readString(data['content']) ?? '';
          const nextStructured = readRecord(data['structured']);
          if (nextStructured !== undefined) structured = nextStructured;
        }
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
      if (timedOut) requestCancellation();
      drain();
    }).catch(reason => finish(toError(reason)));
    timer = setTimeout(() => {
      timedOut = true;
      requestCancellation();
      finish(new Error('The command timed out.'));
    }, 120_000);
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
function readRecord(value: unknown): Record<string, unknown> | undefined { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function readErrorMessage(value: unknown): string | undefined { return typeof value === 'object' && value !== null ? readString((value as Record<string, unknown>)['message']) : readString(value); }
function toError(reason: unknown): Error { return reason instanceof Error ? reason : new Error('The command failed.'); }
