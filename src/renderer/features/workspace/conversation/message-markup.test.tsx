// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageMarkup } from './message-markup.js';

describe('message markup', () => {
  afterEach(() => cleanup());

  it('shows a referenced file name and keeps the full path in the tooltip', async () => {
    const path = 'D:\\workspace\\reports\\result.json';
    render(<MessageMarkup content={`Saved ${path}`} fileReferences={[{ path, name: 'result.json', kind: 'json' }]} />);

    const link = screen.getByRole('link', { name: /result\.json/u });
    expect(link).toHaveClass('message-file-reference');
    expect(link.querySelector('.file-icon-data')).toBeInTheDocument();
    fireEvent.pointerMove(link, { pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(path));
  });

  it('renders external links as a website label with a favicon', () => {
    render(<MessageMarkup content="Open https://example.com/docs now." />);

    const link = screen.getByRole('link', { name: 'example.com' });
    expect(link).toHaveClass('message-external-link');
    expect(link.querySelector('img')).toHaveAttribute('src', 'https://example.com/favicon.ico');
  });

  it('falls back to a favicon image proxy when the website has no root favicon', () => {
    render(<MessageMarkup content="Open https://example.com/docs now." />);

    const image = screen.getByRole('link', { name: 'example.com' }).querySelector('img');
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    expect(image).toHaveAttribute('src', expect.stringContaining('google.com/s2/favicons'));
  });

  it('keeps bare and relative file names as plain message text', () => {
    render(<MessageMarkup content="Đọc file.ts và src/index.ts giúp anh." workspaceCwd="D:\\workspace" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Đọc file.ts và src/index.ts giúp anh.')).toBeInTheDocument();
  });

  it('renders an absolute file path with only its basename', async () => {
    const path = 'D:\\workspace\\src\\index.ts';
    render(<MessageMarkup content={`Open ${path} now.`} />);

    const link = screen.getByRole('link', { name: 'index.ts' });
    expect(link.querySelector('.file-icon-typescript')).toBeInTheDocument();
    fireEvent.pointerMove(link, { pointerType: 'mouse' });
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(path));
  });

  it('does not treat numeric amounts as file references', () => {
    render(<MessageMarkup content="Giá 145.700.000 - 146.800.000 đồng/lượng và 4.454 - 4.600 USD/ounce." workspaceCwd="D:\\workspace" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not treat signed or comma-formatted numbers as file references', () => {
    render(<MessageMarkup content="Giá -145.700.000, +1.234,56, -1,234.56 và -0.5." workspaceCwd="D:\\workspace" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not treat a dotted Windows folder as a file reference', () => {
    render(<MessageMarkup content="Đường dẫn workspace là C:\\workspace\\.codex. Thư mục hiện tại gồm:" workspaceCwd="C:\\workspace" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
