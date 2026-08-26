// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest } from '../../../contracts/ipc/v1/workspace.js';
import { InlineApproval } from './WorkspaceOverlays.js';

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
