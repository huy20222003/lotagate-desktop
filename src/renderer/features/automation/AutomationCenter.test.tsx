// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Automation } from '../../../contracts/ipc/v1/automation.js';
import type { Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { ToastProvider } from '../../components/ui.js';
import { formatTextClamp } from '../../utils/text.js';
import { AutomationCenter } from './AutomationCenter.js';

const workspace: Workspace = { id: 'workspace-1', name: 'Workspace', rootPath: 'C:\\workspace', roots: ['C:\\workspace'], trusted: true, createdAt: '2026-09-01T00:00:00.000Z', lastOpenedAt: '2026-09-01T00:00:00.000Z', settings: {} };
const automation: Automation = {
  id: 'automation-1', name: 'An automation title that is intentionally much longer than the visible list title limit', description: '', prompt: 'Run the workflow.', workspaceId: workspace.id, worktree: false,
  skills: [], tools: [], permissionPolicy: 'ask', browserAccess: 'disabled', schedule: { kind: 'manual' }, retryPolicy: { maxAttempts: 0, backoffMs: 1_000 }, timeoutMs: 60_000,
  notifications: true, keepSession: true, enabled: false, nextRunAt: null, lastRunAt: null, lastError: null, createdAt: workspace.createdAt, updatedAt: workspace.lastOpenedAt,
};

describe('AutomationCenter', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('clamps the title in the outer automation list while preserving the full title tooltip', async () => {
    window.lotagate = { automations: { list: vi.fn().mockResolvedValue([automation]), onState: vi.fn(() => () => {}) } } as unknown as typeof window.lotagate;
    render(<ToastProvider><AutomationCenter workspaces={[workspace]} /></ToastProvider>);

    const title = await screen.findByText(formatTextClamp(64, automation.name));
    expect(title).toHaveAttribute('title', automation.name);
  });
});
