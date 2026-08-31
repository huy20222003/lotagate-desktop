// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { OrchestrationPanel } from './OrchestrationPanel.js';

describe('OrchestrationPanel', () => {
  afterEach(() => cleanup());

  it('does not render an orchestration panel without active subagents', () => {
    render(<OrchestrationPanel subagents={[]} />);

    expect(screen.queryByRole('region', { name: 'Agent orchestration' })).not.toBeInTheDocument();
  });
});
