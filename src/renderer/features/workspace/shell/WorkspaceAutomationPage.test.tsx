// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Automation } from '../../../../contracts/ipc/v1/automation.js';
import type { Workspace } from '../../../../contracts/ipc/v1/workspace.js';
import { ToastProvider } from '../../../components/ui.js';
import { WorkspaceAutomationPage } from './WorkspaceAutomationPage.js';

describe('WorkspaceAutomationPage', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders automations in the workspace layout', () => {
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { automations: { list: vi.fn().mockResolvedValue([]), onState: vi.fn(() => () => {}) } } });
    const workspace = { id: 'workspace-1', name: 'Workspace', rootPath: '/workspace' } as Workspace;

    render(<ToastProvider><WorkspaceAutomationPage workspaces={[workspace]} /></ToastProvider>);

    expect(screen.getByRole('heading', { name: 'Automations', level: 1 })).toBeInTheDocument();
  });

  it('opens the automation drawer only after selecting an item', async () => {
    const automation: Automation = {
      id: 'automation-1', name: 'Quick automation test', description: 'Test automation', prompt: 'Check the workspace.', workspaceId: 'workspace-1', worktree: false,
      skills: [], tools: [], permissionPolicy: 'ask', browserAccess: 'disabled', schedule: { kind: 'manual' }, retryPolicy: { maxAttempts: 0, backoffMs: 1_000 }, timeoutMs: 60_000,
      notifications: true, keepSession: true, enabled: true, nextRunAt: null, lastRunAt: null, lastError: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    };
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { automations: { list: vi.fn().mockResolvedValue([automation]), runs: vi.fn().mockResolvedValue([]), onState: vi.fn(() => () => {}) } } });
    const workspace = { id: 'workspace-1', name: 'Workspace', rootPath: '/workspace' } as Workspace;

    render(<ToastProvider><WorkspaceAutomationPage workspaces={[workspace]} /></ToastProvider>);

    await waitFor(() => expect(document.querySelector<HTMLButtonElement>('.automation-list-item-main')).toBeInTheDocument());
    expect(screen.queryByRole('complementary', { name: 'Automation · Quick automation test' })).not.toBeInTheDocument();
    const item = document.querySelector<HTMLButtonElement>('.automation-list-item-main');
    if (item === null) throw new Error('Automation list item was not rendered.');
    fireEvent.click(item);
    expect(await screen.findByRole('complementary', { name: 'Automation · Quick automation test' })).toBeInTheDocument();
  });

  it('opens a confirmation modal before deleting an automation', async () => {
    const automation: Automation = {
      id: 'automation-1', name: 'Quick automation test', description: 'Hidden from the list', prompt: 'Check the workspace.', workspaceId: 'workspace-1', worktree: false,
      skills: [], tools: [], permissionPolicy: 'ask', browserAccess: 'disabled', schedule: { kind: 'manual' }, retryPolicy: { maxAttempts: 0, backoffMs: 1_000 }, timeoutMs: 60_000,
      notifications: true, keepSession: true, enabled: true, nextRunAt: null, lastRunAt: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', lastError: null,
    };
    const remove = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { automations: { list: vi.fn().mockResolvedValue([automation]), remove, onState: vi.fn(() => () => {}) } } });
    const workspace = { id: 'workspace-1', name: 'Workspace', rootPath: '/workspace' } as Workspace;

    render(<ToastProvider><WorkspaceAutomationPage workspaces={[workspace]} /></ToastProvider>);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete Quick automation test' })).toBeInTheDocument());
    expect(screen.queryByText('Hidden from the list')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Quick automation test' }));
    expect(screen.getByRole('heading', { name: 'Delete automation' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete Quick automation test and its local run history?');
    expect(remove).not.toHaveBeenCalled();
  });
});
