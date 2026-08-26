// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { AgentMarkdown } from './markdown-renderer.js';

describe('agent markdown renderer', () => {
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
});
