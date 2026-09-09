// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiffContextMenu } from './DiffContextMenu.js';

describe('DiffContextMenu', () => {
  afterEach(() => cleanup());

  it('opens the selected file explicitly in VS Code', () => {
    const openFile = vi.fn().mockResolvedValue(undefined);
    window.lotagate = { operations: { openFile } } as unknown as typeof window.lotagate;
    const { container } = render(<DiffContextMenu path="src/app.ts" workspaceCwd="D:/workspace" lineWrap={false} onToggleLineWrap={() => undefined}><div>diff</div></DiffContextMenu>);

    fireEvent.contextMenu(container.querySelector('.diff-context-menu-surface')!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in VS Code' }));

    expect(openFile).toHaveBeenCalledWith('D:/workspace/src/app.ts', 'vscode');
  });

  it('shows both Open with destinations on hover', () => {
    const openFile = vi.fn().mockResolvedValue(undefined);
    window.lotagate = { operations: { openFile } } as unknown as typeof window.lotagate;
    const { container } = render(<DiffContextMenu path="src/app.ts" workspaceCwd="D:/workspace" lineWrap={false} onToggleLineWrap={() => undefined}><div>diff</div></DiffContextMenu>);

    fireEvent.contextMenu(container.querySelector('.diff-context-menu-surface')!);
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Open with' }));

    expect(screen.getByRole('menuitem', { name: 'VS Code' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'File Explorer' })).toBeInTheDocument();
  });

  it('opens the submenu to the left when the right side does not have enough space', async () => {
    const openFile = vi.fn().mockResolvedValue(undefined);
    window.lotagate = { operations: { openFile } } as unknown as typeof window.lotagate;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('diff-context-menu-submenu')) return { width: 190, height: 70, top: 0, bottom: 70, left: 0, right: 190, x: 0, y: 0, toJSON: () => ({}) };
      if (this.classList.contains('diff-context-menu')) return { width: 248, height: 250, top: 40, bottom: 290, left: 250, right: 400, x: 250, y: 40, toJSON: () => ({}) };
      return { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) };
    });
    const { container } = render(<DiffContextMenu path="src/app.ts" workspaceCwd="D:/workspace" lineWrap={false} onToggleLineWrap={() => undefined}><div>diff</div></DiffContextMenu>);

    fireEvent.contextMenu(container.querySelector('.diff-context-menu-surface')!);
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Open with' }));
    await vi.waitFor(() => expect(document.querySelector('.diff-context-menu-submenu')).toHaveClass('is-left'));
  });

  it('still selects the left side when neither side has the full submenu width', async () => {
    const openFile = vi.fn().mockResolvedValue(undefined);
    window.lotagate = { operations: { openFile } } as unknown as typeof window.lotagate;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('diff-context-menu-submenu')) return { width: 190, height: 70, top: 0, bottom: 70, left: 0, right: 190, x: 0, y: 0, toJSON: () => ({}) };
      if (this.classList.contains('diff-context-menu')) return { width: 248, height: 250, top: 40, bottom: 290, left: 100, right: 348, x: 100, y: 40, toJSON: () => ({}) };
      return { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0, x: 0, y: 0, toJSON: () => ({}) };
    });
    const { container } = render(<DiffContextMenu path="src/app.ts" workspaceCwd="D:/workspace" lineWrap={false} onToggleLineWrap={() => undefined}><div>diff</div></DiffContextMenu>);

    fireEvent.contextMenu(container.querySelector('.diff-context-menu-surface')!);
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Open with' }));
    await vi.waitFor(() => expect(document.querySelector('.diff-context-menu-submenu')).toHaveClass('is-left'));
  });
});
