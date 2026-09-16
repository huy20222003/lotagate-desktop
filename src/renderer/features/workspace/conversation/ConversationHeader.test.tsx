// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationHeader } from './ConversationHeader.js';

describe('ConversationHeader', () => {
  afterEach(() => cleanup());

  it('keeps Live Chat hidden while preserving the other session panel actions', () => {
    render(<ConversationHeader
      workspace={{ id: 'workspace-1', name: 'Workspace', rootPath: 'C:\\workspace', roots: ['C:\\workspace'], trusted: true, settings: {}, createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-01-01T00:00:00.000Z' }}
      changesOpen={false}
      sourcesOpen={false}
      terminalOpen={false}
      liveChatOpen={false}
      gitOpen={false}
      onToggleChanges={vi.fn()}
      onToggleSources={vi.fn()}
      onToggleTerminal={vi.fn()}
      onToggleLiveChat={vi.fn()}
      onToggleGit={vi.fn()}
      onRenameTask={vi.fn()}
      onPinTask={vi.fn()}
      onArchiveTask={vi.fn()}
    />);

    expect(screen.queryByRole('button', { name: 'Start live chat' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show terminal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Git panel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show sources' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show changed files panel' })).toBeInTheDocument();
  });
});
