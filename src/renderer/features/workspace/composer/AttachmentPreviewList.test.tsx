// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachmentPreviewList } from './AttachmentPreviewList.js';

describe('AttachmentPreviewList', () => {
  afterEach(() => vi.restoreAllMocks());

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
});
