// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Workspace } from '../../../contracts/ipc/v1/workspace.js';
import { AutomationFormModal } from './AutomationFormModal.js';

const workspace: Workspace = { id: 'workspace-1', name: 'Project', rootPath: 'C:\\project', roots: ['C:\\project'], trusted: true, createdAt: '2026-08-28T00:00:00.000Z', lastOpenedAt: '2026-08-28T00:00:00.000Z', settings: {} };

describe('AutomationFormModal', () => {
  it('submits a schema-compatible manual automation payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AutomationFormModal workspaces={[workspace]} onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('Daily project check'), { target: { value: 'Project check' } });
    fireEvent.change(screen.getByPlaceholderText('Inspect the project, run the checks, and summarize the result.'), { target: { value: 'Inspect the project.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create automation' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ name: 'Project check', prompt: 'Inspect the project.', workspaceId: 'workspace-1', schedule: { kind: 'manual' }, retryPolicy: { maxAttempts: 0, backoffMs: 1_000 }, timeoutMs: 60 * 60 * 1_000 });
  });
});
