// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { LightBox } from './LightBox.js';

vi.mock('swiper/react', () => ({
  Swiper: ({ children, onSlideChange }: { children: ReactNode; onSlideChange?: (swiper: { activeIndex: number }) => void }) => <div data-testid="swiper" onClick={() => onSlideChange?.({ activeIndex: 1 })}>{children}</div>,
  SwiperSlide: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('LightBox', () => {
  it('renders mixed image and video media with download and close actions', () => {
    render(<LightBox items={[{ id: 'image-1', name: 'image.png', src: 'data:image/png;base64,abc', kind: 'image', downloadName: 'image.png' }, { id: 'video-1', name: 'video.mp4', src: 'blob:video', kind: 'video', downloadName: 'video.mp4' }]} onClose={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'image.png' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Download image.png' })).toHaveAttribute('download', 'image.png');
    expect(screen.getByRole('button', { name: 'Previous media' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next media' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close media preview' })).toBeVisible();
    fireEvent.click(screen.getByTestId('swiper'));
    expect(document.querySelector('.lightbox-video')).toBeInTheDocument();
  });
});
