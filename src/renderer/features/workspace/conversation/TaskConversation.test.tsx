// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../../contracts/ipc/v1/workspace.js';
import { TaskConversation } from './TaskConversation.js';

const task: Task = {
  id: 'task-1', workspaceId: 'workspace-1', title: 'Hello', cwd: 'C:/workspace', status: 'active',
  pinned: false, archived: false, draft: '', draftAttachmentIds: [], lastEventCursor: 0, createdAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-29T00:00:00.000Z',
};

describe('TaskConversation live state', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('renders message times and separators for the first message and a three-hour response gap', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 5, 20, 0));
    const messages = [
      { id: 'user-1', taskId: task.id, kind: 'user' as const, text: 'First message', metadata: {}, createdAt: new Date(2026, 8, 5, 12, 1).toISOString() },
      { id: 'assistant-1', taskId: task.id, kind: 'assistant' as const, text: 'First response', metadata: { turnId: 'turn-1' }, createdAt: new Date(2026, 8, 5, 12, 30).toISOString() },
      { id: 'user-2', taskId: task.id, kind: 'user' as const, text: 'Second message', metadata: {}, createdAt: new Date(2026, 8, 5, 15, 30).toISOString() },
    ];

    render(<TaskConversation task={task} activities={messages} activityAttachments={{}} activityArtifacts={{}} fileChangesByTurn={{}} onOpenFileChanges={() => undefined} thinking={false} finalResponseReceived turnTimings={{}} onTrust={async () => undefined} />);

    expect(document.querySelectorAll('.conversation-time-separator')).toHaveLength(2);
    expect(document.querySelectorAll('.conversation-time-separator time')[0]).toHaveTextContent('Today, 12:01 PM');
    expect(document.querySelectorAll('.conversation-time-separator time')[1]).toHaveTextContent('Today, 3:30 PM');
    expect(document.querySelectorAll('.user-message-meta time')[0]).toHaveTextContent('12:01 PM');
    expect(document.querySelector('.agent-message-meta time')).toHaveTextContent('12:30 PM');
    expect(document.querySelectorAll('.user-message-meta time')[1]).toHaveTextContent('3:30 PM');
    expect(screen.queryByText(';')).not.toBeInTheDocument();
  });

  it('keeps the Thinking indicator while work has started but no live action exists yet', () => {
    render(<TaskConversation task={task} activities={[]} activityAttachments={{}} activityArtifacts={{}} fileChangesByTurn={{}} onOpenFileChanges={() => undefined} thinking finalResponseReceived={false} thinkingStartedAt={Date.now()} turnTimings={{}} onTrust={async () => undefined} />);

    expect(screen.getByLabelText('Thinking...')).toBeInTheDocument();
  });

  it('prefers model progress over the host fallback status', () => {
    render(<TaskConversation
      task={task}
      activities={[{
        id: 'progress-1', taskId: task.id, kind: 'assistant', text: 'I will inspect the workspace first.',
        metadata: { turnId: 'turn-1', segmentId: 'turn-1:1', assistantPhase: 'progress' },
        createdAt: task.createdAt,
      }]}
      activityAttachments={{}}
      activityArtifacts={{}}
      fileChangesByTurn={{}}
      onOpenFileChanges={() => undefined}
      statusText="I’ll inspect the workspace with Read file."
      thinking
      finalResponseReceived={false}
      turnTimings={{ 'turn-1': { startedAt: Date.now() } }}
      onTrust={async () => undefined}
    />);

    const progress = screen.getByText('I will inspect the workspace first.');
    expect(progress).toBeInTheDocument();
    expect(progress.closest('details')).toHaveAttribute('open');
    expect(screen.queryByText('I’ll inspect the workspace with Read file.')).not.toBeInTheDocument();
  });

  it('hides the Thinking indicator after the final assistant segment arrives', () => {
    render(<TaskConversation task={task} activities={[]} activityAttachments={{}} activityArtifacts={{}} fileChangesByTurn={{}} onOpenFileChanges={() => undefined} thinking finalResponseReceived thinkingStartedAt={Date.now()} turnTimings={{}} onTrust={async () => undefined} />);

    expect(screen.queryByLabelText('Thinking...')).not.toBeInTheDocument();
  });

  it('renders Worked for once when the final assistant response is streaming', () => {
    render(<TaskConversation
      task={task}
      activities={[
        { id: 'progress-1', taskId: task.id, kind: 'assistant', text: 'I will inspect the file first.', metadata: { turnId: 'turn-1', segmentId: 'turn-1:progress', assistantPhase: 'progress' }, createdAt: task.createdAt },
        { id: 'tool-1', taskId: task.id, kind: 'tool', text: 'Running filesystem.read.', metadata: { turnId: 'turn-1', actionId: 'action-1', toolName: 'filesystem.read', displayName: 'filesystem.read' }, createdAt: task.createdAt },
        { id: 'assistant-1', taskId: task.id, kind: 'assistant', text: 'The file is ready.', metadata: { turnId: 'turn-1', segmentId: 'turn-1:final', assistantPhase: 'final' }, createdAt: task.createdAt },
      ]}
      activityAttachments={{}}
      activityArtifacts={{}}
      fileChangesByTurn={{}}
      onOpenFileChanges={() => undefined}
      thinking
      finalResponseReceived
      turnTimings={{ 'turn-1': { startedAt: Date.now() } }}
      onTrust={async () => undefined}
    />);

    expect(document.querySelectorAll('.worked-time')).toHaveLength(1);
  });

  it('does not duplicate completed tool status above Worked For details', () => {
    render(<TaskConversation
      task={task}
      activities={[{
        id: 'tool-1', taskId: task.id, kind: 'tool', text: 'Read file completed.',
        metadata: { turnId: 'turn-1', actionId: 'action-1', toolName: 'filesystem.read', status: 'completed' },
        createdAt: task.createdAt,
      }]}
      activityAttachments={{}}
      activityArtifacts={{}}
      fileChangesByTurn={{}}
      onOpenFileChanges={() => undefined}
      statusText="Read file · completed"
      thinking
      finalResponseReceived={false}
      turnTimings={{ 'turn-1': { startedAt: Date.now() } }}
      onTrust={async () => undefined}
    />);

    expect(document.querySelector('.worked-status')).not.toBeInTheDocument();
    expect(document.querySelector('.worked-tool')).toHaveTextContent('Ran Read file');
    expect(screen.getByLabelText('Thinking...')).toBeInTheDocument();
  });

  it('hides Thinking while a tool is still running', () => {
    render(<TaskConversation
      task={task}
      activities={[{
        id: 'tool-1', taskId: task.id, kind: 'tool', text: 'Running filesystem.read.',
        metadata: { turnId: 'turn-1', actionId: 'action-1', toolName: 'filesystem.read', status: 'running' },
        createdAt: task.createdAt,
      }]}
      activityAttachments={{}}
      activityArtifacts={{}}
      fileChangesByTurn={{}}
      onOpenFileChanges={() => undefined}
      thinking
      finalResponseReceived={false}
      thinkingStartedAt={Date.now()}
      turnTimings={{ 'turn-1': { startedAt: Date.now() } }}
      onTrust={async () => undefined}
    />);

    expect(screen.queryByLabelText('Thinking...')).not.toBeInTheDocument();
  });

  it('keeps file changes attached to a failed turn instead of rendering them at transcript end', () => {
    render(<TaskConversation
      task={task}
      activities={[
        { id: 'error-1', taskId: task.id, kind: 'error', text: 'The response could not be completed: Agent failed.', metadata: { turnId: 'turn-failed' }, createdAt: task.createdAt },
        { id: 'assistant-2', taskId: task.id, kind: 'assistant', text: 'Mình sẵn sàng hỗ trợ.', metadata: { turnId: 'turn-next', segmentId: 'turn-next:final', assistantPhase: 'final' }, createdAt: task.createdAt },
      ]}
      activityAttachments={{}}
      activityArtifacts={{}}
      fileChangesByTurn={{ 'turn-failed': { files: [{ path: 'test.md', lines: [], additions: 1, deletions: 1, truncated: false }], additions: 1, deletions: 1 } }}
      onOpenFileChanges={() => undefined}
      thinking={false}
      finalResponseReceived
      turnTimings={{ 'turn-failed': { startedAt: Date.now(), endedAt: Date.now() }, 'turn-next': { startedAt: Date.now(), endedAt: Date.now() } }}
      onTrust={async () => undefined}
    />);

    expect(screen.getByText('The response could not be completed: Agent failed.')).toBeInTheDocument();
    expect(screen.getByLabelText('Edited files')).toBeInTheDocument();
    expect(document.querySelectorAll('.file-change-card')).toHaveLength(1);
  });

  it('renders generated files before the diff card and exposes a download action', async () => {
    const openArtifact = vi.fn().mockResolvedValue('');
    const downloadArtifact = vi.fn().mockResolvedValue('/downloads/report.docx');
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { tasks: { openArtifact, downloadArtifact } } });
    const artifact = { id: 'artifact-1', taskId: task.id, name: 'report.docx', path: '/private/report.docx', kind: 'binary' as const, size: 128, createdAt: task.createdAt };

    render(<TaskConversation
      task={task}
      activities={[{ id: 'assistant-1', taskId: task.id, kind: 'assistant', text: 'The report is ready.', metadata: { turnId: 'turn-1', segmentId: 'turn-1:final', assistantPhase: 'final' }, createdAt: task.createdAt }]}
      activityAttachments={{}}
      activityArtifacts={{ 'assistant-1': [artifact] }}
      fileChangesByTurn={{ 'turn-1': { files: [{ path: 'report.docx', lines: [], additions: 1, deletions: 0, truncated: false }], additions: 1, deletions: 0 } }}
      onOpenFileChanges={() => undefined}
      thinking={false}
      finalResponseReceived
      turnTimings={{ 'turn-1': { startedAt: Date.now(), endedAt: Date.now() } }}
      onTrust={async () => undefined}
    />);

    expect(screen.getByText('report.docx')).toBeInTheDocument();
    expect(document.querySelector('.agent-file-response')).toBeInTheDocument();
    expect(document.querySelector('.file-change-card')).toBeInTheDocument();
    screen.getByRole('button', { name: 'Download report.docx' }).click();
    expect(downloadArtifact).toHaveBeenCalledWith(task.id, artifact.id);
  });
});
