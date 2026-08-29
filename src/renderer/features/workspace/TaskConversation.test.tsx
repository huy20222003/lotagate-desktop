// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import type { Task } from '../../../contracts/ipc/v1/workspace.js';
import { TaskConversation } from './TaskConversation.js';

const task: Task = {
  id: 'task-1', workspaceId: 'workspace-1', title: 'Hello', cwd: 'C:/workspace', status: 'active',
  pinned: false, archived: false, draft: '', draftAttachmentIds: [], lastEventCursor: 0, createdAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-29T00:00:00.000Z',
};

describe('TaskConversation live state', () => {
  afterEach(() => cleanup());

  it('keeps the Thinking indicator while work has started but no live action exists yet', () => {
    render(<TaskConversation task={task} activities={[]} activityAttachments={{}} activityArtifacts={{}} fileChangesByTurn={{}} onOpenFileChanges={() => undefined} onOpenImage={() => undefined} thinking thinkingStartedAt={Date.now()} turnTimings={{}} onTrust={async () => undefined} />);

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
      onOpenImage={() => undefined}
      statusText="I’ll inspect the workspace with Read file."
      thinking
      turnTimings={{ 'turn-1': { startedAt: Date.now() } }}
      onTrust={async () => undefined}
    />);

    const progress = screen.getByText('I will inspect the workspace first.');
    expect(progress).toBeInTheDocument();
    expect(progress.closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByText('I’ll inspect the workspace with Read file.')).not.toBeInTheDocument();
  });
});
