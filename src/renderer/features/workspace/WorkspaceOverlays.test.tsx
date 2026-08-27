// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest } from '../../../contracts/ipc/v1/workspace.js';
import { FileChangesDrawer, InlineApproval } from './WorkspaceOverlays.js';
import { SourcesDrawer } from './SourcesDrawer.js';

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
    expect(document.querySelector('.file-change-item > header > .file-change-toggle')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2 unmodified lines' })).toBeVisible();
    expect(screen.queryByText('context-5')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open src/file.ts in a tab' }));
    expect(await screen.findByRole('tab', { name: 'file.ts' })).toBeVisible();
    expect(readFile).toHaveBeenCalledWith('/workspace', 'src/file.ts');
    await waitFor(() => expect(document.querySelector('.file-content')).toHaveTextContent('const completeFile = true;'));
    expect(screen.getAllByText('1', { exact: true }).some(element => element.className === 'file-content-line-number')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'workspace' }));
    expect(await screen.findByRole('menuitem', { name: 'README.md' })).toBeVisible();
    fireEvent.click(screen.getByRole('menuitem', { name: 'README.md' }));
    expect(readFile).toHaveBeenCalledWith('/workspace', 'README.md');
  });
});

describe('SourcesDrawer', () => {
  afterEach(() => cleanup());

  it('loads task artifacts and exposes category tabs and downloads', async () => {
    const artifact = { id: 'artifact-1', taskId: 'task-1', name: 'notes.txt', path: '/private/notes.txt', kind: 'text' as const, size: 12, createdAt: new Date().toISOString() };
    const image = { id: 'artifact-image', taskId: 'task-1', name: 'image.png', path: '/private/image.png', kind: 'image' as const, size: 24, createdAt: new Date().toISOString() };
    const artifacts = vi.fn().mockResolvedValue([artifact, image]);
    const previewArtifact = vi.fn().mockResolvedValue({ artifact: image, dataUrl: 'data:image/png;base64,abc' });
    const downloadArtifact = vi.fn().mockResolvedValue('/downloads/notes.txt');
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { tasks: { artifacts, previewArtifact, downloadArtifact } } });
    render(<SourcesDrawer taskId="task-1" onClose={() => undefined} />);
    expect(await screen.findByText('1 file')).toBeVisible();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Other files' }));
    expect(await screen.findByText('notes.txt')).toBeVisible();
    expect(screen.getByRole('separator', { name: 'Resize sources panel' })).toBeVisible();
    expect(document.querySelector('.source-panel')).toHaveStyle({ width: '520px' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Actions for notes.txt' }), { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: 'Preview' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Download' })).toBeVisible();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download' }));
    expect(downloadArtifact).toHaveBeenCalledWith('task-1', 'artifact-1');
    expect(artifacts).toHaveBeenCalledWith('task-1');
  });

  it('opens a small image through its preview data URL', async () => {
    const artifact = { id: 'artifact-image', taskId: 'task-1', name: 'image.png', path: '/private/image.png', kind: 'image' as const, size: 24, createdAt: new Date().toISOString() };
    const artifacts = vi.fn().mockResolvedValue([artifact]);
    const previewArtifact = vi.fn().mockResolvedValue({ artifact, dataUrl: 'data:image/png;base64,abc' });
    const readArtifactMedia = vi.fn();
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { tasks: { artifacts, previewArtifact, readArtifactMedia } } });
    render(<SourcesDrawer taskId="task-1" onClose={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open image.png' }));
    expect(await screen.findByRole('dialog', { name: 'image.png' })).toBeVisible();
    expect(readArtifactMedia).not.toHaveBeenCalled();
  });
});
