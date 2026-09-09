// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileContentTab } from './FileContentTab.js';

describe('FileContentTab', () => {
  it('renders Shiki token colors for ready file content', async () => {
    window.lotagate = { workspaces: { fileSuggestions: vi.fn().mockResolvedValue([]) } } as unknown as typeof window.lotagate;

    const { container } = render(<FileContentTab cwd="/workspace" path="/workspace/package.json" file={{ status: 'ready', content: '{"name":"lotagate"}' }} onOpenPath={vi.fn()} />);

    expect(container.querySelector('.file-content')).toHaveClass('is-wrapped');
    await waitFor(() => expect(container.querySelector('.file-content-line span[style*="color"]')).toBeTruthy());
    const tokenStyles = Array.from(container.querySelectorAll('.file-content-line span[style*="color"]')).map(token => token.getAttribute('style') ?? '');
    expect(tokenStyles.some(style => style.includes('rgb(156, 220, 254)'))).toBe(true);
    expect(tokenStyles.some(style => style.includes('rgb(206, 145, 120)'))).toBe(true);
  });

  it('browses absolute breadcrumb folders and opens a file from the folder popover', async () => {
    const listDirectory = vi.fn(async (path: string) => path === 'C:/Users'
      ? [{ path: 'C:/Users/demo', kind: 'folder' as const, hasChildren: true }, { path: 'C:/Users/empty', kind: 'folder' as const, hasChildren: false }, { path: 'C:/Users/notes.txt', kind: 'file' as const }]
      : [{ path: 'C:/Users/demo/details.txt', kind: 'file' as const }]);
    const onOpenPath = vi.fn();
    window.lotagate = { operations: { listDirectory }, workspaces: { fileSuggestions: vi.fn().mockResolvedValue([]) } } as unknown as typeof window.lotagate;

    render(<FileContentTab cwd="C:/workspace" path="C:\\Users\\demo\\pasted-file.txt" file={{ status: 'ready', content: 'pasted content' }} onOpenPath={onOpenPath} />);

    const breadcrumbViewport = document.querySelector<HTMLElement>('.file-content-breadcrumb-scrollbar .scrollbar-viewport');
    if (breadcrumbViewport === null) throw new Error('Breadcrumb viewport was not rendered.');
    Object.defineProperties(breadcrumbViewport, { scrollWidth: { configurable: true, value: 600 }, clientWidth: { configurable: true, value: 200 } });
    const usersFolder = screen.getByRole('button', { name: 'Users' });
    fireEvent.pointerDown(usersFolder, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.click(usersFolder);
    expect(await screen.findByRole('menuitem', { name: 'demo' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'empty' })).toBeDisabled();
    expect(screen.queryByText('No files in this folder.')).not.toBeInTheDocument();
    expect(listDirectory).toHaveBeenCalledWith('C:/Users');
    fireEvent.click(screen.getByRole('menuitem', { name: 'demo' }));
    expect(await screen.findByRole('menuitem', { name: 'details.txt' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'notes.txt' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'demo' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'details.txt' }));
    expect(onOpenPath).toHaveBeenCalledWith('C:/Users/demo/details.txt');
  });
});
