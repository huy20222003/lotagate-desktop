// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentMarkdown } from './markdown-renderer.js';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>' }) } }));

describe('agent markdown renderer', () => {
  afterEach(() => cleanup());

  it('renders fenced code with a language header and copy action', () => {
    render(<AgentMarkdown content={'```typescript\nconst value = 1;\n```'} />);

    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    expect(screen.getByText('const value = 1;')).toBeInTheDocument();
  });

  it('removes parser boundary newlines from fenced code', () => {
    render(<AgentMarkdown content={'```\n\n123\n98765\n95t\nplk\n\n```'} />);

    expect(document.querySelector('.markdown-code-block pre')?.textContent).toBe('123\n98765\n95t\nplk');
  });

  it('renders Mermaid fences as clickable diagrams with a source copy action', async () => {
    render(<AgentMarkdown content={'```mermaid\nflowchart TD\n  A[Start] --> B[Done]\n```'} />);

    await waitFor(() => expect(screen.getByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument());
    expect(document.querySelector('.markdown-mermaid-scrollbar .scrollbar-viewport')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Open mermaid diagram' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Copy mermaid source' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('img', { name: 'Mermaid diagram' }).closest('button')!);
    expect(screen.getByRole('button', { name: 'Close media preview' })).toBeInTheDocument();
  });

  it('scopes markdown content so lists use the agent response typography', () => {
    render(<AgentMarkdown content={'- First item\n- Second item'} />);

    expect(screen.getByText('First item').closest('.agent-markdown')).toBeInTheDocument();
  });

  it('keeps a fenced code block embedded in a Markdown file response together', () => {
    const content = ['Nội dung của file test.md như sau:', '', '```markdown', 'hello', '', '```javascript', 'function total(arr) {', '  return arr.reduce((acc, value) => acc + value, 0);', '}', '```', ''].join('\n');
    render(<AgentMarkdown content={content} />);

    expect(screen.getByText('markdown')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Copy code' })).toHaveLength(1);
    expect(screen.queryByText('Plain text')).not.toBeInTheDocument();
    expect(screen.getByText(/```javascript/u)).toBeInTheDocument();
  });

  it('renders known media paths as clickable file links', () => {
    const path = 'D:\\workspace\\images\\generated.png';
    render(<AgentMarkdown content={`Generated image saved:\n  ${path}`} filePaths={[path]} />);

    expect(screen.getByRole('link', { name: 'generated.png' })).toHaveClass('message-file-reference');
  });

  it('does not link a bare file name even when a known absolute path exists', () => {
    const path = 'D:\\workspace\\test.md';
    render(<AgentMarkdown content="The file is `test.md`." filePaths={[path]} />);

    expect(screen.queryByRole('link', { name: 'test.md' })).not.toBeInTheDocument();
    expect(screen.getByText('test.md')).toBeInTheDocument();
  });

  it('does not link a bare file name in an agent response', () => {
    render(<AgentMarkdown content="File test.md hiện tại chứa các nội dung sau:" workspaceCwd="D:\\workspace" />);

    expect(screen.queryByRole('link', { name: 'test.md' })).not.toBeInTheDocument();
    expect(screen.getByText('File test.md hiện tại chứa các nội dung sau:')).toBeInTheDocument();
  });

  it('does not link a relative file path in an agent response', () => {
    render(<AgentMarkdown content="Đã ghi src/custom.template vào workspace." workspaceCwd="D:\\workspace" />);

    expect(screen.queryByRole('link', { name: 'custom.template' })).not.toBeInTheDocument();
    expect(screen.getByText('Đã ghi src/custom.template vào workspace.')).toBeInTheDocument();
  });
});
