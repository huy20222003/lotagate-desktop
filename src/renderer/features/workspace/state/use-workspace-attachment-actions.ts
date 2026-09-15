import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Artifact, Task } from '../../../../contracts/ipc/v1/workspace.js';
import type { AttachmentPreview } from '../../../services/attachment-types.js';
import { loadAttachmentPreviews } from './workspace-controller-helpers.js';
import { PASTED_TEXT_ATTACHMENT_NAME } from '../../../services/pasted-text.js';
import { evaluateGatewayRequestBudget, mimeTypeForAttachmentKind, type GatewayAttachmentBudgetInput } from '../../../../contracts/gateway-request-budget.js';

interface WorkspaceAttachmentActionsOptions {
  readonly task: Task | undefined;
  readonly draftTaskRef: MutableRefObject<Task | undefined>;
  readonly ensureDraftTask: () => Promise<Task | undefined>;
  readonly attachments: readonly AttachmentPreview[];
  readonly setTask: Dispatch<SetStateAction<Task | undefined>>;
  readonly setAttachments: Dispatch<SetStateAction<AttachmentPreview[]>>;
}

export function useWorkspaceAttachmentActions({ task, draftTaskRef, ensureDraftTask, attachments, setTask, setAttachments }: WorkspaceAttachmentActionsOptions) {
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
    if (artifact) {
      try {
        assertGatewayBudget(activeTask.draft, attachments, { byteLength: artifact.size, mimeType: mimeTypeForAttachmentKind(artifact.kind), name: artifact.name });
      } catch (error) {
        await window.lotagate.tasks.deleteArtifact(activeTask.id, artifact.id, true).catch(() => undefined);
        throw error;
      }
      await appendDraftAttachment(artifact);
    }
  }, [appendDraftAttachment, attachments, ensureDraftTask]);

  const attachImage = useCallback(async (name: string, bytes: Uint8Array) => {
    const activeTask = await ensureDraftTask();
    if (!activeTask) return;
    assertGatewayBudget(activeTask.draft, attachments, { byteLength: bytes.byteLength, mimeType: 'image/png', name });
    const artifact = await window.lotagate.tasks.createImageArtifact(activeTask.id, name, bytes);
    await appendDraftAttachment(artifact);
  }, [appendDraftAttachment, attachments, ensureDraftTask]);

  const attachText = useCallback(async (content: string) => {
    const activeTask = await ensureDraftTask();
    if (!activeTask) return;
    const encodedBytes = new TextEncoder().encode(content).byteLength;
    assertGatewayBudget(activeTask.draft, attachments, { byteLength: encodedBytes, mimeType: 'text/plain', name: PASTED_TEXT_ATTACHMENT_NAME });
    const artifact = await window.lotagate.tasks.createTextArtifact(activeTask.id, PASTED_TEXT_ATTACHMENT_NAME, content, 'text', 'pasted-text');
    try {
      if (activeTask.sessionId !== undefined) await window.lotagate.agent.uploadAttachment(activeTask.cwd, { sessionId: activeTask.sessionId, taskId: activeTask.id, attachmentId: artifact.id });
      await appendDraftAttachment(artifact);
    } catch (error) {
      if (activeTask.sessionId !== undefined) await window.lotagate.agent.deleteAttachment(activeTask.cwd, { sessionId: activeTask.sessionId, taskId: activeTask.id, attachmentId: artifact.id }).catch(() => undefined);
      await window.lotagate.tasks.deleteArtifact(activeTask.id, artifact.id, true).catch(() => undefined);
      throw error;
    }
  }, [appendDraftAttachment, attachments, ensureDraftTask]);

  const removeAttachment = useCallback(async (attachmentId: string) => {
    const activeTask = draftTaskRef.current ?? task;
    if (!activeTask || !activeTask.draftAttachmentIds.includes(attachmentId)) return;
    if (activeTask.sessionId !== undefined) await window.lotagate.agent.deleteAttachment(activeTask.cwd, { sessionId: activeTask.sessionId, taskId: activeTask.id, attachmentId });
    await window.lotagate.tasks.deleteArtifact(activeTask.id, attachmentId, true);
    const next = await window.lotagate.tasks.update(activeTask.id, { draftAttachmentIds: activeTask.draftAttachmentIds.filter(id => id !== attachmentId) });
    draftTaskRef.current = next;
    setTask(next);
    setAttachments(current => current.filter(item => item.id !== attachmentId));
  }, [draftTaskRef, setAttachments, setTask, task]);

  return { appendDraftAttachment, pickArtifact, attachImage, attachText, removeAttachment };
}

function assertGatewayBudget(prompt: string, existing: readonly AttachmentPreview[], candidate: GatewayAttachmentBudgetInput): void {
  const budget = evaluateGatewayRequestBudget(prompt, [...existing.map(attachmentBudgetInput), candidate]);
  if (!budget.isWithinLimit || budget.isNearLimit) {
    const reason = budget.isWithinLimit ? `would reach the ${budget.limitBytes * 0.8 / 1_000_000} MB decimal Gateway JSON admission threshold` : `exceed the ${budget.limitBytes / 1_000_000} MB decimal Gateway JSON limit`;
    throw new Error(`This attachment ${reason}. Send the current prompt or remove an attachment before adding another.`);
  }
}

function attachmentBudgetInput(attachment: AttachmentPreview): GatewayAttachmentBudgetInput {
  return { byteLength: attachment.size, mimeType: mimeTypeForAttachmentKind(attachment.kind), name: attachment.name };
}
