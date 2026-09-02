// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileContentTab } from './FileContentTab.js';

describe('FileContentTab', () => {
  it('renders Shiki token colors for ready file content', async () => {
    window.lotagate = { workspaces: { fileSuggestions: vi.fn().mockResolvedValue([]) } } as unknown as typeof window.lotagate;

    const { container } = render(<FileContentTab cwd="/workspace" path="/workspace/package.json" file={{ status: 'ready', content: '{"name":"lotagate"}' }} onOpenPath={vi.fn()} />);

    await waitFor(() => expect(container.querySelector('.file-content-line span[style*="color"]')).toBeTruthy());
    const tokenStyles = Array.from(container.querySelectorAll('.file-content-line span[style*="color"]')).map(token => token.getAttribute('style') ?? '');
    expect(tokenStyles.some(style => style.includes('rgb(156, 220, 254)'))).toBe(true);
    expect(tokenStyles.some(style => style.includes('rgb(206, 145, 120)'))).toBe(true);
  });
});
