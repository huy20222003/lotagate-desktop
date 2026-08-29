import type { Activity, Artifact } from '../../../contracts/ipc/v1/workspace.js';
import type { AttachmentPreview } from './attachment-types.js';
import type { QueuedMessage } from './message-queue-service.js';

export async function loadAttachmentPreviews(taskId: string, attachmentIds: readonly string[] = [], availableArtifacts?: Artifact[]): Promise<AttachmentPreview[]> {
  const artifacts = (availableArtifacts ?? await window.lotagate.tasks.artifacts(taskId)).filter(artifact => attachmentIds.includes(artifact.id));
  return Promise.all(artifacts.map(async artifact => {
    const preview = await window.lotagate.tasks.previewArtifact(taskId, artifact.id).catch(() => undefined);
    const dataUrl = preview?.dataUrl;
    return { id: artifact.id, name: artifact.name, kind: artifact.kind, size: artifact.size, path: artifact.path, ...(dataUrl ? { dataUrl } : {}) };
  }));
}

export async function loadActivityAttachmentPreviews(taskId: string, activities: readonly Activity[]): Promise<Record<string, AttachmentPreview[]>> {
  const userActivities = activities.filter(activity => activity.kind === 'user').map(activity => ({ activity, attachmentIds: readAttachmentIds(activity.metadata['attachmentIds']) })).filter(item => item.attachmentIds.length > 0);
  if (userActivities.length === 0) return {};
  const artifacts = await window.lotagate.tasks.artifacts(taskId).catch(() => []);
  const entries = await Promise.all(userActivities.map(async ({ activity, attachmentIds }) => [activity.id, await loadAttachmentPreviews(taskId, attachmentIds, artifacts)] as const));
  return Object.fromEntries(entries);
}

export async function loadActivityArtifactPreviews(taskId: string, activities: readonly Activity[]): Promise<Record<string, Artifact[]>> {
  const mediaActivities = activities.filter(activity => activity.kind === 'assistant').map(activity => ({ activity, artifactIds: readAttachmentIds(activity.metadata['artifactIds']) })).filter(item => item.artifactIds.length > 0);
  if (mediaActivities.length === 0) return {};
  const artifacts = await window.lotagate.tasks.artifacts(taskId).catch(() => []);
  return Object.fromEntries(mediaActivities.map(({ activity, artifactIds }) => [activity.id, artifacts.filter(artifact => artifactIds.includes(artifact.id))] as const));
}

export async function importMediaArtifacts(taskId: string, paths: readonly string[]): Promise<{ artifacts: Artifact[]; failures: string[] }> {
  const artifacts: Artifact[] = [];
  const failures: string[] = [];
  for (const sourcePath of paths) {
    try {
      artifacts.push(await window.lotagate.tasks.importArtifact(taskId, sourcePath));
    } catch {
      failures.push(sourcePath);
    }
  }
  return { artifacts, failures };
}

export function extractSessionId(value: unknown): string | undefined { if (typeof value !== 'object' || value === null) return undefined; const session = (value as Record<string, unknown>)['session']; if (typeof session !== 'object' || session === null) return undefined; const id = (session as Record<string, unknown>)['id']; return typeof id === 'string' ? id : undefined; }
export function extractTurnId(value: unknown): string | undefined { if (typeof value !== 'object' || value === null) return undefined; const id = (value as Record<string, unknown>)['turnId']; return typeof id === 'string' ? id : undefined; }
export function readAttachmentIds(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : []; }
export function readMediaPaths(value: unknown, fallbackText = ''): string[] {
  const paths = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 4_096) : [];
  if (paths.length > 0) return paths;
  const matches = fallbackText.matchAll(/(?:[A-Za-z]:[\\/]|\\\\|\/)[^<>`\r\n]+?\.(?:png|jpe?g|gif|webp|bmp|mp3|wav|m4a|aac|flac|ogg|mp4|webm|mov|m4v|avi)\b/giu);
  return [...new Set([...matches].map(match => match[0]!.trim()))];
}
export function mergeActivities(current: readonly Activity[], incoming: readonly Activity[]): Activity[] {
  const byId = new Map(current.map(activity => [activity.id, activity]));
  for (const activity of incoming) byId.set(activity.id, activity);
  const persistedAssistantKeys = new Set(incoming.filter(activity => activity.kind === 'assistant').map(activity => assistantActivityKey(activity)));
  for (const [id, activity] of byId) if (isLiveStreamingActivity(activity) && persistedAssistantKeys.has(assistantActivityKey(activity))) byId.delete(id);
  return [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function isLiveStreamingActivity(activity: Activity): boolean {
  if (activity.kind !== 'assistant') return false;
  const segment = readString(activity.metadata['segmentId']) ?? readTurnId(activity) ?? 'active';
  return activity.id === `streaming:${activity.taskId}:${segment}`;
}
function assistantActivityKey(activity: Activity): string { return `${activity.taskId}:${readString(activity.metadata['segmentId']) ?? readTurnId(activity) ?? 'active'}`; }
function readTurnId(activity: Activity): string | undefined { const value = activity.metadata['turnId']; return typeof value === 'string' && value.length > 0 ? value : undefined; }
function readString(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }

export async function discardQueuedAttachments(taskId: string | undefined, messages: readonly QueuedMessage[], activities: readonly Activity[], protectedAttachmentIds: readonly string[]): Promise<void> {
  if (taskId === undefined) return;
  const referencedByActivities = activities.flatMap(activity => readAttachmentIds(activity.metadata['attachmentIds']));
  const protectedIds = new Set([...protectedAttachmentIds, ...referencedByActivities]);
  const attachmentIds = [...new Set(messages.flatMap(message => message.attachments.map(attachment => attachment.id)))];
  for (const attachmentId of attachmentIds) {
    if (protectedIds.has(attachmentId)) continue;
    await window.lotagate.tasks.deleteArtifact(taskId, attachmentId, true).catch(() => undefined);
  }
}
