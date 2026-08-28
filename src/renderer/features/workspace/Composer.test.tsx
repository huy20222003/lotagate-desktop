// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../contracts/ipc/v1/workspace.js';
import { Composer } from './Composer.js';

function taskWithDraft(draft: string): Task {
  return {
    id: 'task-1', workspaceId: 'workspace-1', title: 'Test task', cwd: 'C:\\workspace', status: 'active',
    pinned: false, archived: false, draft, draftAttachmentIds: [], lastEventCursor: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('Composer overlays', () => {
  it('closes the slash picker outside the composer and reopens it on input focus', () => {
    render(<Composer
      disabled={false}
      thinking={false}
      task={taskWithDraft('/')}
      attachments={[]}
      queuedMessages={[]}
      models={[]}
      selectedModel=""
      onModel={vi.fn()}
      busy={false}
      onSend={vi.fn().mockResolvedValue(undefined)}
      onRunCommand={vi.fn().mockResolvedValue(false)}
      onCancel={vi.fn().mockResolvedValue(undefined)}
      onDraft={vi.fn().mockResolvedValue(undefined)}
      onAttach={vi.fn().mockResolvedValue(undefined)}
      onAttachImage={vi.fn().mockResolvedValue(undefined)}
      onRemoveAttachment={vi.fn().mockResolvedValue(undefined)}
      onSteerQueued={vi.fn().mockResolvedValue(undefined)}
      onRemoveQueued={vi.fn().mockResolvedValue(undefined)}
      onEditQueued={vi.fn().mockResolvedValue(undefined)}
      onOpenImage={vi.fn()}
      approvalMode="auto"
      onApprovalMode={vi.fn()}
      onApproval={vi.fn().mockResolvedValue(undefined)}
    />);

    expect(screen.getByText('No available slash commands.')).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText('No available slash commands.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('textbox', { name: 'Prompt' }));
    expect(screen.getByText('No available slash commands.')).toBeVisible();
  });
});
