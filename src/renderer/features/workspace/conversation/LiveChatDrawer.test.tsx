// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { LiveChatDrawer } from './LiveChatDrawer.js';

describe('LiveChatDrawer', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the header and stays in hands-free listening mode', () => {
    const handleClose = vi.fn();
    const handleSend = vi.fn().mockResolvedValue(undefined);

    const { container, getByRole } = render(
      <LiveChatDrawer
        cwd="D:\\test-workspace"
        models={[]}
        thinking={false}
        error={undefined}
        assistantActivities={[]}
        activeTurnId={undefined}
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

    // Hands-free mode does not expose a manual start/stop mic control.
    expect(container.querySelector('.live-chat-footer')).not.toBeInTheDocument();
    expect(container.querySelector('.live-chat-mic-btn')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('Tap microphone to speak');

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
        assistantActivities={[]}
        activeTurnId={undefined}
        assistantFinalResponse={undefined}
        onSend={handleSend}
        onClose={handleClose}
      />
    );

    expect(container.querySelector('.live-chat-stage')).toBeInTheDocument();
    expect(container.querySelector('.live-chat-mic-btn')).not.toBeInTheDocument();
  });

  it('starts TTS when a streamed sentence completes before the final response', async () => {
    const synthesize = vi.fn().mockResolvedValue({ audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/mpeg' });
    Object.defineProperty(window, 'lotagate', {
      configurable: true,
      value: { speech: { synthesize, transcribe: vi.fn() } },
    });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    class TestAudio {
      oncanplay: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onloadeddata: (() => void) | null = null;
      preload = '';
      src = '';
      load() { this.onloadeddata?.(); }
      pause() { return undefined; }
      play() { this.onended?.(); return Promise.resolve(); }
    }
    vi.stubGlobal('Audio', TestAudio);

    const activity: Activity = {
      id: 'streaming:task-1:segment-1',
      taskId: 'task-1',
      kind: 'assistant',
      text: 'Hello from the streamed response. ',
      metadata: { turnId: 'turn-1', segmentId: 'segment-1', assistantPhase: 'progress' },
      createdAt: '2026-09-12T00:00:00.000Z',
    };
    const handleSend = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <LiveChatDrawer
        cwd="D:\\test-workspace"
        models={[]}
        thinking
        error={undefined}
        assistantActivities={[]}
        activeTurnId={undefined}
        assistantFinalResponse={undefined}
        onSend={handleSend}
        onClose={vi.fn()}
      />
    );

    rerender(
      <LiveChatDrawer
        cwd="D:\\test-workspace"
        models={[]}
        thinking
        error={undefined}
        assistantActivities={[activity]}
        activeTurnId="turn-1"
        assistantFinalResponse={undefined}
        onSend={handleSend}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(1));
    expect(synthesize).toHaveBeenCalledWith('D:\\\\test-workspace', expect.objectContaining({ input: 'Hello from the streamed response.' }));
  });

  it('retries speech playback with WAV when the browser cannot decode MP3', async () => {
    const synthesize = vi
      .fn()
      .mockResolvedValueOnce({ audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/mpeg' })
      .mockResolvedValueOnce({ audio: new Uint8Array([4, 5, 6]), mimeType: 'audio/wav' });
    Object.defineProperty(window, 'lotagate', {
      configurable: true,
      value: { speech: { synthesize, transcribe: vi.fn() } },
    });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    let loadCount = 0;
    class FallbackAudio {
      oncanplay: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onloadeddata: (() => void) | null = null;
      preload = '';
      src = '';
      load() {
        loadCount += 1;
        if (loadCount === 1) this.onerror?.();
        else this.onloadeddata?.();
      }
      pause() { return undefined; }
      play() { this.onended?.(); return Promise.resolve(); }
    }
    vi.stubGlobal('Audio', FallbackAudio);

    const activity: Activity = {
      id: 'streaming:task-1:segment-1',
      taskId: 'task-1',
      kind: 'assistant',
      text: 'Hello from the streamed response. ',
      metadata: { turnId: 'turn-1', segmentId: 'segment-1', assistantPhase: 'progress' },
      createdAt: '2026-09-12T00:00:00.000Z',
    };
    const { rerender } = render(
      <LiveChatDrawer
        cwd="D:\\test-workspace"
        models={[]}
        thinking
        error={undefined}
        assistantActivities={[]}
        activeTurnId={undefined}
        assistantFinalResponse={undefined}
        onSend={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />
    );

    rerender(
      <LiveChatDrawer
        cwd="D:\\test-workspace"
        models={[]}
        thinking
        error={undefined}
        assistantActivities={[activity]}
        activeTurnId="turn-1"
        assistantFinalResponse={undefined}
        onSend={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(synthesize).toHaveBeenCalledTimes(2));
    expect(synthesize.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ responseFormat: 'wav' }));
  });
});
