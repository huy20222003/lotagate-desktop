// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task, Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { Composer } from './Composer.js';

function taskWithDraft(draft: string): Task {
  return {
    id: 'task-1', workspaceId: 'workspace-1', title: 'Test task', cwd: 'C:\\workspace', status: 'active',
    pinned: false, archived: false, draft, draftAttachmentIds: [], lastEventCursor: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function workspace(): Workspace {
  return { id: 'workspace-1', name: 'Workspace', rootPath: 'C:\\workspace', roots: ['C:\\workspace'], trusted: true, settings: {}, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z' };
}

describe('Composer overlays', () => {
  afterEach(() => cleanup());
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

  it('shows typed file badges and navigates mention suggestions with arrow keys', async () => {
    const suggestions = [{ path: 'src/index.ts', kind: 'file' as const }, { path: 'README.md', kind: 'file' as const }];
    Object.defineProperty(window, 'lotagate', { configurable: true, value: {
      agent: { commandList: vi.fn().mockRejectedValue(new Error('not available')), commandExecute: vi.fn().mockRejectedValue(new Error('not available')) },
      extensions: { listProjectHooks: vi.fn().mockRejectedValue(new Error('not available')) },
      workspaces: { fileSuggestions: vi.fn().mockResolvedValue(suggestions) },
    } });
    render(<Composer
      disabled={false}
      workspace={workspace()}
      thinking={false}
      task={taskWithDraft('@')}
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

    const input = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    input.setSelectionRange(1, 1);
    fireEvent.click(input);
    const first = await screen.findByRole('option', { name: /index\.ts/u });
    expect(first.querySelector('.file-icon-typescript')).toBeInTheDocument();
    expect(first.querySelector('.mention-suggestion-copy strong')).toHaveTextContent('index.ts');
    expect(first.querySelector('.mention-suggestion-copy small')).toHaveTextContent('src/');
    const second = screen.getByRole('option', { name: 'README.md' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(second).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(first).toHaveAttribute('aria-selected', 'true');
  });
});
