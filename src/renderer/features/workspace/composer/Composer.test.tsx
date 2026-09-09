// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task, Workspace } from '../../../../contracts/ipc/v1/workspace.js';
import { Composer } from './Composer.js';

function taskWithDraft(draft: string, cwd = 'C:\\workspace'): Task {
  return {
    id: 'task-1', workspaceId: 'workspace-1', title: 'Test task', cwd, status: 'active',
    pinned: false, archived: false, draft, draftAttachmentIds: [], lastEventCursor: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function workspace(rootPath = 'C:\\workspace'): Workspace {
  return { id: 'workspace-1', name: 'Workspace', rootPath, roots: [rootPath], trusted: true, settings: {}, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z' };
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
      selectedEffort="medium"
      onModel={vi.fn()}
      onEffort={vi.fn()}
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
      selectedEffort="medium"
      onModel={vi.fn()}
      onEffort={vi.fn()}
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
    expect(first.querySelector('.mention-suggestion-copy strong')).toHaveTextContent('src/index.ts');
    const second = screen.getByRole('option', { name: 'README.md' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(second).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(first).toHaveAttribute('aria-selected', 'true');
  });

  it('loads file suggestions from the selected workspace root', async () => {
    const fileSuggestions = vi.fn().mockResolvedValue([{ path: 'test-md/test.md', kind: 'file' as const }]);
    const onSend = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'lotagate', { configurable: true, value: {
      agent: { commandList: vi.fn().mockRejectedValue(new Error('not available')), commandExecute: vi.fn().mockRejectedValue(new Error('not available')) },
      extensions: { listProjectHooks: vi.fn().mockRejectedValue(new Error('not available')) },
      workspaces: { fileSuggestions },
    } });
    render(<Composer
      disabled={false}
      workspace={workspace('C:\\project')}
      thinking={false}
      task={taskWithDraft('@', 'C:\\execution-worktree\\user-tests')}
      attachments={[]}
      queuedMessages={[]}
      models={[]}
      selectedModel=""
      selectedEffort="medium"
      onModel={vi.fn()}
      onEffort={vi.fn()}
      busy={false}
      onSend={onSend}
      onRunCommand={vi.fn().mockResolvedValue(false)}
      onCancel={vi.fn().mockResolvedValue(undefined)}
      onDraft={vi.fn().mockResolvedValue(undefined)}
      onAttach={vi.fn().mockResolvedValue(undefined)}
      onAttachImage={vi.fn().mockResolvedValue(undefined)}
      onRemoveAttachment={vi.fn().mockResolvedValue(undefined)}
      onSteerQueued={vi.fn().mockResolvedValue(undefined)}
      onRemoveQueued={vi.fn().mockResolvedValue(undefined)}
      onEditQueued={vi.fn().mockResolvedValue(undefined)}
      approvalMode="auto"
      onApprovalMode={vi.fn()}
      onApproval={vi.fn().mockResolvedValue(undefined)}
    />);

    const input = screen.getByRole('textbox', { name: 'Prompt' });
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    fireEvent.click(input);
    const option = await screen.findByRole('option', { name: 'test-md/test.md' });
    expect(fileSuggestions).toHaveBeenCalledWith('C:\\project', '');
    fireEvent.click(option);
    expect(input).toHaveValue('test.md ');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('@test-md/test.md', undefined);
  });

  it('clears the submitted prompt before the send lifecycle finishes', () => {
    let resolveSend: (() => void) | undefined;
    const onSend = vi.fn(() => new Promise<void>(resolve => { resolveSend = resolve; }));
    render(<Composer
      disabled={false}
      thinking={false}
      task={taskWithDraft('hello')}
      attachments={[]}
      queuedMessages={[]}
      models={[]}
      selectedModel=""
      selectedEffort="medium"
      onModel={vi.fn()}
      onEffort={vi.fn()}
      busy={false}
      onSend={onSend}
      onRunCommand={vi.fn().mockResolvedValue(false)}
      onCancel={vi.fn().mockResolvedValue(undefined)}
      onDraft={vi.fn().mockResolvedValue(undefined)}
      onAttach={vi.fn().mockResolvedValue(undefined)}
      onAttachImage={vi.fn().mockResolvedValue(undefined)}
      onRemoveAttachment={vi.fn().mockResolvedValue(undefined)}
      onSteerQueued={vi.fn().mockResolvedValue(undefined)}
      onRemoveQueued={vi.fn().mockResolvedValue(undefined)}
      onEditQueued={vi.fn().mockResolvedValue(undefined)}
      approvalMode="auto"
      onApprovalMode={vi.fn()}
      onApproval={vi.fn().mockResolvedValue(undefined)}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue('');
    expect(onSend).toHaveBeenCalledWith('hello', undefined);
    resolveSend?.();
  });

  it('opens reasoning effort card, controls effort via slider, and separates model selection popover', () => {
    const onModel = vi.fn();
    const onEffort = vi.fn();
    render(<Composer
      disabled={false}
      thinking={false}
      task={taskWithDraft('')}
      attachments={[]}
      queuedMessages={[]}
      models={[{ id: 'internal-model-id', label: 'Friendly model' }]}
      selectedModel="internal-model-id"
      selectedEffort="medium"
      onModel={onModel}
      onEffort={onEffort}
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
      approvalMode="auto"
      onApprovalMode={vi.fn()}
      onApproval={vi.fn().mockResolvedValue(undefined)}
    />);

    const trigger = screen.getByRole('button', { name: 'Select model and effort' });
    expect(trigger).toHaveTextContent('Friendly model');
    expect(trigger).toHaveTextContent('medium');

    fireEvent.click(trigger);

    expect(screen.getByText(/Medium/u)).toBeInTheDocument();
    const modelBtn = screen.getByRole('button', { name: 'Select model' });
    expect(modelBtn).toHaveTextContent('Friendly model');

    const slider = screen.getByRole('slider', { name: 'Reasoning effort' });
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-valuenow', '1');
    expect(slider).toHaveAttribute('aria-valuetext', 'medium');

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(onEffort).toHaveBeenCalledWith('high');

    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(onEffort).toHaveBeenCalledWith('low');

    const resetBtn = screen.getByRole('button', { name: 'Reset reasoning effort' });
    fireEvent.click(resetBtn);
    expect(onEffort).toHaveBeenCalledWith('medium');

    expect(screen.queryByRole('menu', { name: 'Models' })).not.toBeInTheDocument();
    fireEvent.click(modelBtn);
    const modelMenu = screen.getByRole('menu', { name: 'Models' });
    expect(modelMenu).toBeVisible();
    expect(within(modelMenu).getByText('Friendly model')).toBeVisible();

    fireEvent.click(within(modelMenu).getByRole('menuitem', { name: 'Friendly model' }));
    expect(onModel).toHaveBeenCalledWith('internal-model-id');
    expect(screen.queryByRole('menu', { name: 'Models' })).not.toBeInTheDocument();

    // Closing the effort card via Escape key
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('slider', { name: 'Reasoning effort' })).not.toBeInTheDocument();
  });
});
