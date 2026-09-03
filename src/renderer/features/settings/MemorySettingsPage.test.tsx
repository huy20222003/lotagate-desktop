// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

const memory = (statement: string) => ({ id: statement, scope: 'project' as const, kind: 'episodic' as const, status: 'verified' as const, statement, evidenceRefs: [], updatedAt: '2026-09-03T00:00:00.000Z', useCount: 0 });

describe('MemorySettingsPage', () => {
  beforeEach(() => { clientMocks.list.mockReset(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('keeps only the latest workspace response when an earlier request resolves late', async () => {
    const oldResolvers: Array<(rows: readonly ReturnType<typeof memory>[]) => void> = [];
    clientMocks.list.mockImplementation((cwd: string, scope: 'user' | 'project') => cwd === 'C:\\old'
      ? new Promise(resolve => { oldResolvers.push(resolve); })
      : Promise.resolve(scope === 'project' ? [memory('new memory')] : []));
    const view = render(<ToastProvider><MemorySettingsPage cwd="C:\\old" /></ToastProvider>);

    expect(document.querySelector('.settings-memory-table-skeleton')).toBeInTheDocument();
    view.rerender(<ToastProvider><MemorySettingsPage cwd="C:\\new" /></ToastProvider>);
    await waitFor(() => expect(screen.getByText('new memory')).toBeVisible());
    oldResolvers.forEach(resolve => resolve([memory('old memory')]));
    await waitFor(() => expect(screen.queryByText('old memory')).not.toBeInTheDocument());
  });
});
