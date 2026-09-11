// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachmentPreviewList } from './AttachmentPreviewList.js';

describe('AttachmentPreviewList', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads and displays a video attachment thumbnail', async () => {
    const readArtifactMedia = vi.fn().mockResolvedValue({ bytes: new Uint8Array([0]), mimeType: 'video/mp4' });
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { tasks: { readArtifactMedia } } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    render(<AttachmentPreviewList taskId="task-1" attachments={[{ id: 'artifact-1', name: 'clip.mp4', kind: 'video', size: 1 }]} />);

    await waitFor(() => expect(document.querySelector('.image-attachment-open video')).toHaveAttribute('src', 'blob:video-preview'));
    expect(readArtifactMedia).toHaveBeenCalledWith('task-1', 'artifact-1');
    expect(screen.getByRole('button', { name: 'Open video clip.mp4' })).toBeInTheDocument();
  });

  it('shows pasted text as a compact preview and opens it in VS Code', () => {
    const openFile = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { operations: { openFile } } });

    render(<AttachmentPreviewList attachments={[{ id: 'artifact-1', name: 'pasted-file.txt', kind: 'text', source: 'pasted-text', size: 1200, path: 'C:\\attachments\\pasted-file.txt', subtitle: 'A long pasted instruction…' }]} />);

    expect(screen.getByText('A long pasted instruction…')).toBeInTheDocument();
    expect(screen.getByText('Pasted text')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open pasted-file.txt' })).toBeInTheDocument();
    screen.getByRole('button', { name: 'Open pasted-file.txt' }).click();
    expect(openFile).toHaveBeenCalledWith('C:\\attachments\\pasted-file.txt', 'vscode');
  });

  it('opens persisted file attachments through the shared file opener', () => {
    const openFile = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { operations: { openFile } } });

    render(<AttachmentPreviewList attachments={[{ id: 'artifact-2', name: 'test.md', kind: 'markdown', size: 32, path: 'C:\\workspace\\test.md' }]} />);

    screen.getByRole('button', { name: 'Open test.md' }).click();
    expect(openFile).toHaveBeenCalledWith('C:\\workspace\\test.md');
  });

  it('marks a composer list containing pasted text so media previews can share its compact height', () => {
    const readArtifactMedia = vi.fn().mockResolvedValue({ bytes: new Uint8Array([0]), mimeType: 'image/png' });
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { tasks: { readArtifactMedia } } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    render(<AttachmentPreviewList taskId="task-1" onRemove={vi.fn().mockResolvedValue(undefined)} attachments={[{ id: 'image-1', name: 'image.png', kind: 'image', size: 1 }, { id: 'text-1', name: 'pasted.txt', kind: 'text', source: 'pasted-text', size: 1 }]} />);

    expect(document.querySelector('.composer-attachment-list')).toHaveClass('has-pasted-text');
  });

  it('renders remove buttons on both image and text attachments and triggers onRemove', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const readArtifactMedia = vi.fn().mockResolvedValue({ bytes: new Uint8Array([0]), mimeType: 'image/png' });
    Object.defineProperty(window, 'lotagate', { configurable: true, value: { tasks: { readArtifactMedia } } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    render(<AttachmentPreviewList taskId="task-1" onRemove={onRemove} attachments={[{ id: 'image-1', name: 'image.png', kind: 'image', size: 1 }, { id: 'text-1', name: 'pasted.txt', kind: 'text', source: 'pasted-text', size: 1 }]} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove image.png' })).toHaveClass('image-attachment-remove'));
    const removeImageBtn = screen.getByRole('button', { name: 'Remove image.png' });
    const removeTextBtn = screen.getByRole('button', { name: 'Remove pasted.txt' });
    expect(removeTextBtn).toHaveClass('attachment-remove');

    removeImageBtn.click();
    expect(onRemove).toHaveBeenCalledWith('image-1');

    removeTextBtn.click();
    expect(onRemove).toHaveBeenCalledWith('text-1');
  });
});
