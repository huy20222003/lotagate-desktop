// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui.js';
import { MemorySettingsPage } from './MemorySettingsPage.js';

const clientMocks = vi.hoisted(() => ({ list: vi.fn(), forget: vi.fn(), show: vi.fn(), clear: vi.fn(), export: vi.fn(), previewImport: vi.fn(), import: vi.fn() }));

vi.mock('./memory-command-client.js', () => ({
  MemoryCommandClient: class {
    list = clientMocks.list;
    forget = clientMocks.forget;
    show = clientMocks.show;
    clear = clientMocks.clear;
    export = clientMocks.export;
    previewImport = clientMocks.previewImport;
    import = clientMocks.import;
  },
}));

const memory = (statement: string) => ({ id: statement, kind: 'episodic' as const, status: 'verified' as const, statement, evidenceRefs: [], updatedAt: '2026-09-03T00:00:00.000Z', useCount: 0 });

describe('MemorySettingsPage', () => {
  beforeEach(() => { clientMocks.list.mockReset(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('keeps only the latest workspace response when an earlier request resolves late', async () => {
    const oldResolvers: Array<(rows: readonly ReturnType<typeof memory>[]) => void> = [];
    clientMocks.list.mockImplementation((cwd: string) => cwd === 'C:\\old'
      ? new Promise(resolve => { oldResolvers.push(resolve); })
      : Promise.resolve([memory('new memory')]));
    const view = render(<ToastProvider><MemorySettingsPage cwd="C:\\old" /></ToastProvider>);

    expect(document.querySelector('.settings-memory-table-skeleton')).toBeInTheDocument();
    view.rerender(<ToastProvider><MemorySettingsPage cwd="C:\\new" /></ToastProvider>);
    await waitFor(() => expect(screen.getByText('new memory')).toBeVisible());
    oldResolvers.forEach(resolve => resolve([memory('old memory')]));
    await waitFor(() => expect(screen.queryByText('old memory')).not.toBeInTheDocument());
  });

  it('keeps the table visible when the workspace has no memories', async () => {
    clientMocks.list.mockResolvedValue([]);
    render(<ToastProvider><MemorySettingsPage cwd="C:\workspace" /></ToastProvider>);
    await waitFor(() => expect(screen.getByText('No local memories.')).toBeVisible());
    expect(screen.getByRole('columnheader', { name: 'Memory' })).toBeVisible();
    expect(document.querySelector('.settings-form-card')).not.toBeInTheDocument();
  });

  it('reports loading failures through the shared toast instead of an inline card', async () => {
    clientMocks.list.mockRejectedValue(new Error('Memory service unavailable.'));
    render(<ToastProvider><MemorySettingsPage cwd="C:\workspace" /></ToastProvider>);
    await waitFor(() => expect(screen.getByText('Unable to load memory')).toBeVisible());
    expect(screen.getByText('Memory service unavailable.')).toBeVisible();
    expect(document.querySelector('.settings-extension-error')).not.toBeInTheDocument();
  });

  it('validates and imports the selected file from one Import action', async () => {
    const pickFile = vi.fn().mockResolvedValue('C:\\memory.json');
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { workspaces: { pickFile } } });
    clientMocks.list.mockResolvedValue([]);
    clientMocks.previewImport.mockResolvedValue(2);
    clientMocks.import.mockResolvedValue({ imported: 2, skipped: 0 });
    render(<ToastProvider><MemorySettingsPage cwd="C:\workspace" /></ToastProvider>);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(clientMocks.import).toHaveBeenCalledWith('C:\\workspace', 'C:\\memory.json'));
    expect(pickFile).toHaveBeenCalledWith(undefined, ['json']);
    expect(clientMocks.previewImport).toHaveBeenCalledWith('C:\\workspace', 'C:\\memory.json');
  });
});
