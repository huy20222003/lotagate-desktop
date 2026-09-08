import { dialog } from 'electron';
import { z } from 'zod';
import type { TaskUpdate } from '../tasks/task-store.js';
import { assertTrustedRenderer } from './sender-policy.js';
import { artifactKind } from '../artifacts/artifact-kind.js';
import type { IpcRegistrationContext } from './ipc-registration-context.js';

export function registerTaskIpcHandlers(context: IpcRegistrationContext): void {
  const { handle, tasks, workspaces, artifacts, operations, idSchema, objectSchema, taskUpdateSchema, taskTitleSourceInputSchema, activityPageOptionsSchema, cwdSchema } = context;
handle('task.list', async (event, workspaceId?: unknown) => { assertTrustedRenderer(event); return tasks.list(workspaceId === undefined ? undefined : idSchema.parse(workspaceId)); });
handle('task.create', async (event, input: unknown) => {
    assertTrustedRenderer(event);
    const value = objectSchema.parse(input);
    const workspaceId = idSchema.parse(value['workspaceId']);
    const workspace = await workspaces.require(workspaceId);
    return tasks.create({ workspaceId, cwd: workspace.rootPath, title: z.string().min(1).parse(value['title']), ...(value['titleSource'] === undefined ? {} : { titleSource: taskTitleSourceInputSchema.parse(value['titleSource']) }), ...(value['prompt'] === undefined ? {} : { prompt: z.string().parse(value['prompt']) }) });
  });
handle('task.update', async (event, taskId: unknown, patch: unknown) => { assertTrustedRenderer(event); return tasks.update(idSchema.parse(taskId), taskUpdateSchema.parse(patch) as TaskUpdate); });
handle('task.queuedPrompts', async (event, taskId: unknown) => { assertTrustedRenderer(event); return tasks.queuedPrompts(idSchema.parse(taskId)); });
handle('task.queuePrompt', async (event, taskId: unknown, input: unknown) => { assertTrustedRenderer(event); const id = idSchema.parse(taskId); const value = objectSchema.parse(input); const attachmentIds = z.array(idSchema).max(16).parse(value['attachmentIds'] ?? []); await artifacts.attachmentInputs(id, attachmentIds); return tasks.queuePrompt(id, { prompt: z.string().min(1).max(512 * 1024).parse(value['prompt']), ...(value['agentPrompt'] === undefined ? {} : { agentPrompt: z.string().min(1).max(512 * 1024).parse(value['agentPrompt']) }), ...(value['model'] === undefined ? {} : { model: z.string().min(1).max(256).parse(value['model']) }), skills: z.array(z.string().min(1).max(256)).max(32).parse(value['skills'] ?? []), attachmentIds }); });
handle('task.dequeuePrompt', async (event, taskId: unknown, promptId: unknown) => { assertTrustedRenderer(event); return tasks.dequeuePrompt(idSchema.parse(taskId), idSchema.parse(promptId)); });
handle('task.rename', async (event, taskId: unknown, title: unknown) => { assertTrustedRenderer(event); return tasks.rename(idSchema.parse(taskId), z.string().min(1).max(200).parse(title)); });
handle('task.status', async (event, taskId: unknown, status: unknown) => { assertTrustedRenderer(event); return tasks.setStatus(idSchema.parse(taskId), z.enum(['queued', 'active', 'completed', 'failed', 'cancelled', 'paused', 'interrupted']).parse(status)); });
handle('task.retry', async (event, taskId: unknown) => { assertTrustedRenderer(event); return tasks.retry(idSchema.parse(taskId)); });
handle('task.cancel', async (event, taskId: unknown) => { assertTrustedRenderer(event); return tasks.cancel(idSchema.parse(taskId)); });
handle('task.resume', async (event, taskId: unknown) => { assertTrustedRenderer(event); return tasks.resume(idSchema.parse(taskId)); });
handle('task.archive', async (event, taskId: unknown, archived: unknown) => { assertTrustedRenderer(event); return tasks.archive(idSchema.parse(taskId), z.boolean().parse(archived)); });
handle('task.pin', async (event, taskId: unknown, pinned: unknown) => { assertTrustedRenderer(event); return tasks.pin(idSchema.parse(taskId), z.boolean().parse(pinned)); });
handle('task.activity', async (event, taskId: unknown, kind: unknown, text: unknown, metadata?: unknown) => { assertTrustedRenderer(event); return tasks.appendActivity(idSchema.parse(taskId), z.enum(['user', 'assistant', 'tool', 'command', 'file', 'approval', 'trust', 'usage', 'context', 'error', 'verification']).parse(kind), z.string().parse(text), metadata === undefined ? {} : objectSchema.parse(metadata)); });
handle('task.activities', async (event, taskId: unknown) => { assertTrustedRenderer(event); return tasks.activities(idSchema.parse(taskId)); });
handle('task.activitiesPage', async (event, taskId: unknown, options?: unknown) => {
    assertTrustedRenderer(event);
    const value = options === undefined ? {} : activityPageOptionsSchema.parse(options);
    return tasks.activitiesPage(idSchema.parse(taskId), { ...(value.limit === undefined ? {} : { limit: value.limit }), ...(value.before === undefined ? {} : { before: value.before }) });
  });
handle('task.dailyUsage', async event => { assertTrustedRenderer(event); return tasks.dailyUsage(); });
handle('task.artifacts', async (event, taskId: unknown) => { assertTrustedRenderer(event); return artifacts.list(idSchema.parse(taskId)); });
handle('task.pickArtifact', async (event, taskId: unknown) => { assertTrustedRenderer(event); const selected = await dialog.showOpenDialog({ properties: ['openFile'] }); if (selected.canceled || selected.filePaths[0] === undefined) return null; return artifacts.importFile(idSchema.parse(taskId), selected.filePaths[0], artifactKind(selected.filePaths[0])); });
handle('task.importArtifact', async (event, taskId: unknown, sourcePath: unknown) => { assertTrustedRenderer(event); const path = cwdSchema.parse(sourcePath); return artifacts.importFile(idSchema.parse(taskId), path, artifactKind(path)); });
handle('task.createTextArtifact', async (event, taskId: unknown, name: unknown, content: unknown, kind?: unknown) => { assertTrustedRenderer(event); return artifacts.createText(idSchema.parse(taskId), z.string().min(1).max(200).parse(name), z.string().max(8 * 1024 * 1024).parse(content), kind === undefined ? 'text' : z.enum(['text', 'markdown', 'patch', 'json']).parse(kind)); });
handle('task.createImageArtifact', async (event, taskId: unknown, name: unknown, bytes: unknown) => { assertTrustedRenderer(event); if (!(bytes instanceof Uint8Array)) throw new Error('Invalid image bytes.'); return artifacts.createImage(idSchema.parse(taskId), z.string().min(1).max(200).parse(name), bytes); });
handle('task.deleteArtifact', async (event, taskId: unknown, artifactId: unknown, confirmed: unknown) => { assertTrustedRenderer(event); return artifacts.delete(idSchema.parse(taskId), idSchema.parse(artifactId), z.boolean().parse(confirmed)); });
handle('task.previewArtifact', async (event, taskId: unknown, artifactId: unknown) => { assertTrustedRenderer(event); return artifacts.preview(idSchema.parse(taskId), idSchema.parse(artifactId)); });
handle('task.readArtifactMedia', async (event, taskId: unknown, artifactId: unknown) => { assertTrustedRenderer(event); return artifacts.readMedia(idSchema.parse(taskId), idSchema.parse(artifactId)); });
handle('task.downloadArtifact', async (event, taskId: unknown, artifactId: unknown) => {
    assertTrustedRenderer(event);
    const artifact = await artifacts.list(idSchema.parse(taskId));
    const selected = artifact.find(item => item.id === idSchema.parse(artifactId));
    if (selected === undefined) throw new Error('Artifact was not found.');
    const destination = await dialog.showSaveDialog({ defaultPath: selected.name });
    if (destination.canceled || destination.filePath === undefined) return null;
    await artifacts.download(selected.taskId, selected.id, destination.filePath);
    return destination.filePath;
  });
handle('task.openArtifact', async (event, taskId: unknown, artifactId: unknown) => { assertTrustedRenderer(event); const path = await artifacts.path(idSchema.parse(taskId), idSchema.parse(artifactId)); await operations.openFile(path); return ''; });
}
