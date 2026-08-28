// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentMarkdown } from './markdown-renderer.js';

describe('agent markdown renderer', () => {
  afterEach(() => cleanup());

  it('renders fenced code with a language header and copy action', () => {
    render(<AgentMarkdown content={'```typescript\nconst value = 1;\n```'} />);

    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    expect(screen.getByText('const value = 1;')).toBeInTheDocument();
  });

  it('scopes markdown content so lists use the agent response typography', () => {
    render(<AgentMarkdown content={'- First item\n- Second item'} />);

    expect(screen.getByText('First item').closest('.agent-markdown')).toBeInTheDocument();
  });

  it('renders known media paths as clickable file links', () => {
    const path = 'D:\\workspace\\images\\generated.png';
    render(<AgentMarkdown content={`Generated image saved:\n  ${path}`} filePaths={[path]} />);

    expect(screen.getByRole('link', { name: 'generated.png' })).toHaveClass('message-file-reference');
  });

  it('marks file references inside inline markdown elements', () => {
    const path = 'D:\\workspace\\test.md';
    render(<AgentMarkdown content="The file is `test.md`." filePaths={[path]} />);

    expect(screen.getByRole('link', { name: 'test.md' })).toHaveClass('message-file-reference');
  });

  it('recognizes a bare file name in an agent response using the workspace path', () => {
    render(<AgentMarkdown content="File test.md hiện tại chứa các nội dung sau:" workspaceCwd="D:\\workspace" />);

    expect(screen.getByRole('link', { name: 'test.md' })).toHaveClass('message-file-reference');
  });

  it('recognizes relative files with extensions outside the common file list', () => {
    render(<AgentMarkdown content="Đã ghi src/custom.template vào workspace." workspaceCwd="D:\\workspace" />);

    expect(screen.getByRole('link', { name: 'custom.template' })).toHaveClass('message-file-reference');
  });
});
