// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { ImageLightbox } from './ImageLightbox.js';

describe('ImageLightbox', () => {
  it('provides download and close actions', () => {
    render(<ImageLightbox src="data:image/png;base64,abc" alt="pasted.png" downloadName="pasted.png" onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Download pasted.png' })).toHaveAttribute('download', 'pasted.png');
    expect(screen.getByRole('button', { name: 'Close image preview' })).toBeVisible();
  });
});
