import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Artifact, Task } from '../../../../contracts/ipc/v1/workspace.js';
import type { AttachmentPreview } from '../../../services/attachment-types.js';
import { loadAttachmentPreviews } from './workspace-controller-helpers.js';
import { PASTED_TEXT_ATTACHMENT_NAME } from '../../../services/pasted-text.js';

interface WorkspaceAttachmentActionsOptions {
  readonly task: Task | undefined;
  readonly draftTaskRef: MutableRefObject<Task | undefined>;
  readonly ensureDraftTask: () => Promise<Task | undefined>;
  readonly setTask: Dispatch<SetStateAction<Task | undefined>>;
  readonly setAttachments: Dispatch<SetStateAction<AttachmentPreview[]>>;
}

export function useWorkspaceAttachmentActions({ task, draftTaskRef, ensureDraftTask, setTask, setAttachments }: WorkspaceAttachmentActionsOptions) {
  const appendDraftAttachment = useCallback(async (artifact: Artifact) => {
    const activeTask = draftTaskRef.current ?? task;
    if (!activeTask || activeTask.draftAttachmentIds.includes(artifact.id)) return;
    const next = await window.lotagate.tasks.update(activeTask.id, { draftAttachmentIds: [...activeTask.draftAttachmentIds, artifact.id] });
    draftTaskRef.current = next;
    setTask(next);
    setAttachments(await loadAttachmentPreviews(next.id, next.draftAttachmentIds));
  }, [draftTaskRef, setAttachments, setTask, task]);

  const pickArtifact = useCallback(async () => {
    const activeTask = await ensureDraftTask();
    if (!activeTask) return;
    const artifact = await window.lotagate.tasks.pickArtifact(activeTask.id);
    if (artifact) await appendDraftAttachment(artifact);
  }, [appendDraftAttachment, ensureDraftTask]);

  const attachImage = useCallback(async (name: string, bytes: Uint8Array) => {
    const activeTask = await ensureDraftTask();
    if (!activeTask) return;
    const artifact = await window.lotagate.tasks.createImageArtifact(activeTask.id, name, bytes);
    await appendDraftAttachment(artifact);
  }, [appendDraftAttachment, ensureDraftTask]);

  const attachText = useCallback(async (content: string) => {
    const activeTask = await ensureDraftTask();
    if (!activeTask) return;
    const artifact = await window.lotagate.tasks.createTextArtifact(activeTask.id, PASTED_TEXT_ATTACHMENT_NAME, content, 'text', 'pasted-text');
    await appendDraftAttachment(artifact);
  }, [appendDraftAttachment, ensureDraftTask]);

  const removeAttachment = useCallback(async (attachmentId: string) => {
    const activeTask = draftTaskRef.current ?? task;
    if (!activeTask || !activeTask.draftAttachmentIds.includes(attachmentId)) return;
    await window.lotagate.tasks.deleteArtifact(activeTask.id, attachmentId, true);
    const next = await window.lotagate.tasks.update(activeTask.id, { draftAttachmentIds: activeTask.draftAttachmentIds.filter(id => id !== attachmentId) });
    draftTaskRef.current = next;
    setTask(next);
    setAttachments(current => current.filter(item => item.id !== attachmentId));
  }, [draftTaskRef, setAttachments, setTask, task]);

  return { appendDraftAttachment, pickArtifact, attachImage, attachText, removeAttachment };
}
