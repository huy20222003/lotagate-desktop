// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest } from '../../../contracts/ipc/v1/workspace.js';
import { FileChangesDrawer, InlineApproval } from './WorkspaceOverlays.js';

const request: ApprovalRequest = {
  approvalId: 'approval-1',
  taskId: 'task-1',
  turnId: 'turn-1',
  toolName: 'shell.exec',
  displayName: 'Shell command',
  kind: 'shell',
  detail: { summary: 'Run command: npm test', command: 'npm test' },
};

describe('InlineApproval', () => {
  afterEach(() => cleanup());

  it('presents the approval action without a prompt input', () => {
    render(<InlineApproval request={request} onDecision={vi.fn(async () => undefined)} />);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Do you want to allow shell command?');
    expect(screen.getByText('Run command: npm test')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Yes, allow' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'No, deny' })).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('sends the selected decision and prevents duplicate submissions', async () => {
    let resolveDecision: (() => void) | undefined;
    const onDecision = vi.fn(() => new Promise<void>(resolve => { resolveDecision = resolve; }));
    render(<InlineApproval request={request} onDecision={onDecision} />);
    const allow = screen.getByRole('button', { name: 'Yes, allow' });
    fireEvent.click(allow);
    fireEvent.click(allow);
    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith(true);
    expect(allow).toBeDisabled();
    resolveDecision?.();
    await waitFor(() => expect(allow).toBeEnabled());
  });

  it('moves the decision focus with the arrow keys', () => {
    render(<InlineApproval request={request} onDecision={vi.fn(async () => undefined)} />);
    const allow = screen.getByRole('button', { name: 'Yes, allow' });
    const deny = screen.getByRole('button', { name: 'No, deny' });
    expect(allow).toHaveFocus();
    fireEvent.keyDown(allow, { key: 'ArrowDown' });
    expect(deny).toHaveFocus();
    fireEvent.keyDown(deny, { key: 'ArrowUp' });
    expect(allow).toHaveFocus();
  });
});

describe('FileChangesDrawer', () => {
  afterEach(() => cleanup());

  it('collapses long unchanged regions and opens file content in a tab', async () => {
    const readFile = vi.fn().mockResolvedValue('const completeFile = true;\nsecond line;');
    const fileSuggestions = vi.fn().mockResolvedValue([{ path: 'README.md', kind: 'file' as const }]);
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { git: { readFile }, workspaces: { fileSuggestions } } });
    const contextLines = Array.from({ length: 8 }, (_, index) => ({ kind: 'context' as const, text: `context-${index + 1}`, oldLine: index + 1, newLine: index + 1 }));
    render(<FileChangesDrawer cwd="/workspace" summary={{ additions: 1, deletions: 0, files: [{ path: 'src/file.ts', additions: 1, deletions: 0, truncated: false, lines: [...contextLines, { kind: 'addition', text: 'new line', newLine: 9 }] }] }} onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: '2 unmodified lines' })).toBeVisible();
    expect(screen.queryByText('context-5')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open src/file.ts in a tab' }));
    expect(await screen.findByRole('tab', { name: 'file.ts' })).toBeVisible();
    expect(readFile).toHaveBeenCalledWith('/workspace', 'src/file.ts');
    expect(await screen.findByText('const completeFile = true;')).toBeVisible();
    expect(screen.getAllByText('1', { exact: true }).some(element => element.className === 'file-content-line-number')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'workspace' }));
    expect(await screen.findByRole('menuitem', { name: 'README.md' })).toBeVisible();
    fireEvent.click(screen.getByRole('menuitem', { name: 'README.md' }));
    expect(readFile).toHaveBeenCalledWith('/workspace', 'README.md');
  });
});
