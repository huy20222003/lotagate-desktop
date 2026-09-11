// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveChatDrawer } from './LiveChatDrawer.js';

describe('LiveChatDrawer', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the header, animated voice orb, and mic button', () => {
    const handleClose = vi.fn();
    const handleSend = vi.fn().mockResolvedValue(undefined);

    const { container, getByRole } = render(
      <LiveChatDrawer
        cwd="D:\\test-workspace"
        models={[]}
        thinking={false}
        error={undefined}
        assistantFinalResponse={undefined}
        onSend={handleSend}
        onClose={handleClose}
      />
    );

    // Header
    expect(container.querySelector('.live-chat-title strong')?.textContent).toBe('Live chat');
    const closeBtn = getByRole('button', { name: 'Close live chat' });
    expect(closeBtn).toBeInTheDocument();

    // Voice Orb central stage
    const orbStage = container.querySelector('.live-chat-stage');
    expect(orbStage).toBeInTheDocument();
    expect(container.querySelector('.live-orb-ambient-glow')).toBeInTheDocument();
    expect(container.querySelector('.live-orb-sphere')).toBeInTheDocument();
    expect(container.querySelector('.live-orb-layer-base')).toBeInTheDocument();
    expect(container.querySelector('.live-orb-layer-white')).toBeInTheDocument();
    expect(container.querySelector('.live-orb-layer-cloud')).toBeInTheDocument();
    expect(container.querySelector('.live-orb-layer-swirl')).toBeInTheDocument();
    expect(container.querySelector('.live-orb-rim')).toBeInTheDocument();

    // Status indicator
    const statusContainer = container.querySelector('.live-chat-status-container');
    expect(statusContainer).toBeInTheDocument();

    // Bottom mic control button
    const footer = container.querySelector('.live-chat-footer');
    expect(footer).toBeInTheDocument();
    const micBtn = container.querySelector('.live-chat-mic-btn');
    expect(micBtn).toBeInTheDocument();

    // Does NOT render old transcript or waveform canvas boxes
    expect(container.querySelector('.live-chat-transcript')).not.toBeInTheDocument();
    expect(container.querySelector('.live-chat-wave')).not.toBeInTheDocument();

    // Close button triggers onClose
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('handles agent error gracefully in the live chat stage', () => {
    const handleClose = vi.fn();
    const handleSend = vi.fn().mockResolvedValue(undefined);

    const { container } = render(
      <LiveChatDrawer
        cwd="D:\\test-workspace"
        models={[]}
        thinking={false}
        error="Network connection lost"
        assistantFinalResponse={undefined}
        onSend={handleSend}
        onClose={handleClose}
      />
    );

    expect(container.querySelector('.live-chat-stage')).toBeInTheDocument();
    expect(container.querySelector('.live-chat-mic-btn')).toBeInTheDocument();
  });
});
