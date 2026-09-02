// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Automation } from '../../../contracts/ipc/v1/automation.js';
import { formatTextClamp } from '../../utils/text.js';
import { AutomationDetailsDrawer } from './AutomationDetailsDrawer.js';

const automation: Automation = {
  id: 'automation-1', name: 'A very long automation title that should be clamped inside the details drawer', description: 'A concise description.', prompt: 'A'.repeat(400), workspaceId: 'workspace-1', worktree: false,
  skills: [], tools: [], permissionPolicy: 'ask', browserAccess: 'disabled', schedule: { kind: 'manual' }, retryPolicy: { maxAttempts: 0, backoffMs: 1_000 }, timeoutMs: 60_000,
  notifications: true, keepSession: true, enabled: false, nextRunAt: null, lastRunAt: null, lastError: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('AutomationDetailsDrawer', () => {
  afterEach(() => cleanup());

  it('clamps the drawer title and instruction and places status below the instruction', () => {
    render(<AutomationDetailsDrawer automation={automation} workspaceName="Workspace" busy={false} refreshToken={0} onClose={vi.fn()} onRun={vi.fn()} onCancel={vi.fn()} onRetry={vi.fn()} onReview={vi.fn()} onApproval={vi.fn()} />);

    expect(screen.getByRole('complementary', { name: formatTextClamp(64, `Automation · ${automation.name}`) })).toBeInTheDocument();
    expect(screen.getByText(formatTextClamp(280, automation.prompt))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run now' })).not.toHaveTextContent('Run now');
    const instructions = screen.getByRole('heading', { name: 'Instructions' }).parentElement;
    expect(instructions).not.toBeNull();
    expect(instructions?.querySelector('.ui-badge')).toHaveTextContent('Paused');
    const heading = screen.getByRole('button', { name: 'Run now' }).parentElement;
    expect(heading?.querySelector('.ui-badge')).toBeNull();
  });
});
