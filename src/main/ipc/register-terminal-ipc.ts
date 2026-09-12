import { z } from 'zod';
import { assertTrustedRenderer } from './sender-policy.js';
import { terminalExecutionInputSchema, terminalSessionOpenSchema, terminalSessionResizeSchema } from '../../contracts/ipc/v1/workspace.js';
import type { IpcRegistrationContext } from './ipc-registration-context.js';
import { createTerminalOutputDispatcher, type TerminalOutputDispatcher } from '../terminal/terminal-output-dispatcher.js';

export function registerTerminalIpcHandlers(context: IpcRegistrationContext): void {
  const { handle, terminal, interactiveTerminal, tasks, requireWorkspaceCwd, idSchema } = context;
  const dispatchers = new Map<string, TerminalOutputDispatcher>();
handle('terminal.execute', async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const value = terminalExecutionInputSchema.parse(input);
    const result = await terminal.execute({ ...value, cwd: await requireWorkspaceCwd(value.cwd) });
    if (value.taskId) await tasks.appendActivity(value.taskId, 'verification', `${value.command} ${value.args.join(' ')}`.trim(), { cwd: result.cwd, exitCode: result.exitCode, durationMs: result.durationMs, truncated: result.truncated, evidenceId: result.id, output: `${result.stdout}\n${result.stderr}`.slice(0, 4_096) });
    return result;
  });
handle('terminal.list', async (event, taskId?: unknown) => { assertTrustedRenderer(event); return terminal.list(taskId === undefined ? undefined : idSchema.parse(taskId)); });
handle('terminal.open', async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const value = terminalSessionOpenSchema.parse(input);
    let sessionId: string | undefined;
    const dispatcher = createTerminalOutputDispatcher(event.sender, 'pending');
    try {
      const session = await interactiveTerminal.open({ ...value, cwd: await requireWorkspaceCwd(value.cwd) }, event.sender.id, output => dispatcher.push(output));
      sessionId = session.id;
      const key = `${event.sender.id}:${session.id}`;
      dispatcher.setSessionId(session.id);
      dispatchers.set(key, dispatcher);
      event.sender.once('destroyed', () => {
        for (const [dispatcherKey, current] of dispatchers) if (dispatcherKey.startsWith(`${event.sender.id}:`)) { current.close(false); dispatchers.delete(dispatcherKey); }
        interactiveTerminal.closeOwner(event.sender.id);
      });
      return session;
    } catch (error) {
      dispatcher.close(false);
      if (sessionId !== undefined) interactiveTerminal.close(sessionId, event.sender.id);
      throw error;
    }
  });
handle('terminal.write', async (event, sessionId: unknown, data: unknown) => { assertTrustedRenderer(event); interactiveTerminal.write(idSchema.parse(sessionId), z.string().min(1).max(128 * 1024).parse(data), event.sender.id); });
handle('terminal.resize', async (event, input: unknown) => { assertTrustedRenderer(event); const value = terminalSessionResizeSchema.parse(input); interactiveTerminal.resize(value.sessionId, value.cols, value.rows, event.sender.id); });
handle('terminal.close', async (event, sessionId: unknown) => { assertTrustedRenderer(event); const id = idSchema.parse(sessionId); interactiveTerminal.close(id, event.sender.id); const key = `${event.sender.id}:${id}`; dispatchers.get(key)?.close(); dispatchers.delete(key); });
}
