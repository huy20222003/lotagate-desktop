import { z } from 'zod';
import { assertTrustedRenderer } from './sender-policy.js';
import type { IpcRegistrationContext } from './ipc-registration-context.js';
import { DESKTOP_REASONING_EFFORTS, type DesktopReasoningEffort } from '../../contracts/agent-protocol/v1/desktop.js';

export function registerAgentIpcHandlers(context: IpcRegistrationContext): void {
  const { handle, agents, approvals, artifacts, tasks, logger, requireWorkspaceCwd, idSchema, objectSchema } = context;
handle('agent.initialize', async (event, cwd: unknown) => {
    assertTrustedRenderer(event);
    return agents.initialize(await requireWorkspaceCwd(cwd));
  });
handle('agent.shutdown', async (event, cwd: unknown) => {
    assertTrustedRenderer(event);
    const projectRoot = await requireWorkspaceCwd(cwd);
    logger.info('agent.shutdown.requested', { cwd: projectRoot, source: 'ipc' });
    await approvals.cancelWhere(request => request.workspaceCwd === projectRoot);
    await agents.shutdown(projectRoot, 'ipc.agent.shutdown');
    logger.info('agent.shutdown.completed', { cwd: projectRoot, source: 'ipc' });
  });
handle('agent.sessionCreate', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.sessionCreate(await requireWorkspaceCwd(cwd), objectSchema.parse(input) as { model?: string; name?: string }); });
handle('agent.sessionList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return agents.sessionList(await requireWorkspaceCwd(cwd)); });
handle('agent.sessionResume', async (event, cwd: unknown, sessionId: unknown) => { assertTrustedRenderer(event); return agents.sessionResume(await requireWorkspaceCwd(cwd), idSchema.parse(sessionId)); });
handle('agent.turnClaim', async (event, cwd: unknown, taskId: unknown, sessionId?: unknown) => { assertTrustedRenderer(event); const canonicalCwd = await requireWorkspaceCwd(cwd); const id = idSchema.parse(taskId); await tasks.requireForCwd(id, canonicalCwd); const owner = typeof sessionId === 'string' && sessionId.length > 0 ? idSchema.parse(sessionId) : undefined; return context.taskTurns.claim(id, canonicalCwd, owner); });
handle('agent.turnRelease', async (event, taskId: unknown, token: unknown) => { assertTrustedRenderer(event); context.taskTurns.release(idSchema.parse(taskId), idSchema.parse(token)); });
handle('agent.turnStart', async (event, cwd: unknown, input: unknown) => {
    assertTrustedRenderer(event);
    const canonicalCwd = await requireWorkspaceCwd(cwd);
    const value = objectSchema.parse(input);
    const attachmentIds = value['attachmentIds'] === undefined ? [] : z.array(idSchema).max(16).parse(value['attachmentIds']);
    const taskId = value['taskId'] === undefined ? undefined : idSchema.parse(value['taskId']);
    const turnClaimToken = value['turnClaimToken'] === undefined ? undefined : idSchema.parse(value['turnClaimToken']);
    const sessionId = idSchema.parse(value['sessionId']);
    const task = taskId === undefined ? undefined : await tasks.requireForCwd(taskId, canonicalCwd);
    if (task?.sessionId !== undefined && task.sessionId !== sessionId) throw new Error('The task session does not match the requested agent session.');
    const attachments = taskId === undefined ? [] : await artifacts.attachmentInputs(taskId, attachmentIds);
    const skills = value['skills'] === undefined ? undefined : z.array(z.string().min(1).max(256)).max(32).parse(value['skills']);
    const reasoningEffort = value['reasoningEffort'] === undefined ? undefined : parseReasoningEffort(value['reasoningEffort']);
    let claimToken = turnClaimToken;
    if (taskId !== undefined && claimToken === undefined) claimToken = context.taskTurns.claim(taskId, canonicalCwd);
    if (taskId !== undefined && claimToken !== undefined) { if (!context.taskTurns.owns(taskId, claimToken)) throw new Error('The task turn claim is invalid or expired.'); context.taskTurns.bind(taskId, claimToken, sessionId); }
    try {
      return await agents.turnStart(canonicalCwd, { sessionId, prompt: z.string().min(1).max(512 * 1024).parse(value['prompt']), ...(value['model'] === undefined ? {} : { model: z.string().min(1).max(256).parse(value['model']) }), ...(reasoningEffort === undefined ? {} : { reasoningEffort }), ...(taskId === undefined ? {} : { taskId }), ...(value['sessionName'] === undefined ? {} : { sessionName: z.string().min(1).max(120).parse(value['sessionName']) }), ...(skills === undefined ? {} : { skills }), ...(attachments.length === 0 ? {} : { attachments }) });
    } catch (error) {
      if (taskId !== undefined && claimToken !== undefined) context.taskTurns.release(taskId, claimToken);
      throw error;
    }
  });
handle('agent.turnCancel', async (event, cwd: unknown, turnId: unknown) => {
    assertTrustedRenderer(event);
    const projectRoot = await requireWorkspaceCwd(cwd);
    const requestedTurnId = idSchema.parse(turnId);
    const cancelPendingApprovals = () => approvals.cancelWhere(request => request.workspaceCwd === projectRoot && request.turnId === requestedTurnId, { notifyDecision: false });
    await cancelPendingApprovals();
    try { return await agents.turnCancel(projectRoot, requestedTurnId); }
    finally { await cancelPendingApprovals(); }
  });
handle('agent.trustRespond', async (event, cwd: unknown, input: unknown) => { assertTrustedRenderer(event); return agents.trustRespond(await requireWorkspaceCwd(cwd), objectSchema.parse(input) as { trustRequestId: string; trusted: boolean }); });
handle('agent.modelList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return agents.modelList(await requireWorkspaceCwd(cwd)); });
handle('agent.commandList', async (event, cwd: unknown) => { assertTrustedRenderer(event); return agents.commandList(await requireWorkspaceCwd(cwd)); });
handle('agent.commandExecute', async (event, cwd: unknown, input: unknown) => {
    assertTrustedRenderer(event);
    const projectRoot = await requireWorkspaceCwd(cwd);
    const command = objectSchema.parse(input);
    const actionId = z.string().min(1).max(256).parse(command['actionId']);
    const options = command['options'];
    const scope = typeof options === 'object' && options !== null && !Array.isArray(options) && typeof (options as Record<string, unknown>)['scope'] === 'string' ? (options as Record<string, unknown>)['scope'] : undefined;
    logger.info('agent.command.requested', { cwd: projectRoot, actionId, ...(scope === undefined ? {} : { scope }) });
    const result = await agents.commandExecute(projectRoot, { ...command, actionId });
    const commandId = typeof result === 'object' && result !== null && typeof (result as Record<string, unknown>)['commandId'] === 'string' ? (result as Record<string, unknown>)['commandId'] : undefined;
    logger.info('agent.command.accepted', { cwd: projectRoot, actionId, ...(commandId === undefined ? {} : { commandId }) });
    return result;
  });
handle('agent.commandCancel', async (event, cwd: unknown, commandId: unknown) => { assertTrustedRenderer(event); return agents.commandCancel(await requireWorkspaceCwd(cwd), idSchema.parse(commandId)); });
}

function parseReasoningEffort(value: unknown): DesktopReasoningEffort {
  if (typeof value !== 'string' || !(DESKTOP_REASONING_EFFORTS as readonly string[]).includes(value)) throw new Error('Invalid reasoning effort.');
  return value as DesktopReasoningEffort;
}
