// @vitest-environment jsdom

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { formatTextClamp } from '../../../utils/text.js';
import { ConversationTimeline } from './ConversationTimeline.js';

function userActivities(count: number): Activity[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `user-${index + 1}`,
    taskId: 'task-1',
    kind: 'user' as const,
    text: `Message ${index + 1}`,
    metadata: {},
    createdAt: new Date(2026, 0, 1, 0, index).toISOString(),
  }));
}

describe('ConversationTimeline', () => {
  it('centers markers while the timeline content fits its viewport', () => {
    const viewportRef = { current: document.createElement('div') };
    const view = render(<ConversationTimeline activities={userActivities(10)} onSelect={() => undefined} viewportRef={viewportRef} />);
    const positions = Array.from(view.container.querySelectorAll<HTMLButtonElement>('.conversation-timeline-marker')).map(marker => Number.parseFloat(marker.style.top));
    const estimatedHeight = Math.max(220, Math.min(window.innerHeight * 0.72, 720));

    expect(positions[0]).toBeGreaterThan(100);
    expect(positions[positions.length - 1]).toBeLessThan(estimatedHeight);
    expect((positions[0]! + positions[positions.length - 1]!) / 2).toBeCloseTo(estimatedHeight / 2, 5);
    expect(positions.slice(1).map((position, index) => position - positions[index]!)).toEqual(Array(9).fill(18));
  });

  it('keeps the overflowed timeline scrollable instead of centering its track', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: () => undefined });
    const viewportRef = { current: document.createElement('div') };
    const view = render(<ConversationTimeline activities={userActivities(40)} onSelect={() => undefined} viewportRef={viewportRef} />);
    const positions = Array.from(view.container.querySelectorAll<HTMLButtonElement>('.conversation-timeline-marker')).map(marker => Number.parseFloat(marker.style.top));

    expect(positions[0]).toBe(14);
    expect(positions[positions.length - 1]).toBeGreaterThan(positions[0]! + 500);
  });

  it('shows clamped user and agent previews when a marker is hovered', () => {
    const viewportRef = { current: document.createElement('div') };
    const users = userActivities(2);
    const activities: Activity[] = [
      users[0]!,
      { id: 'assistant-1', taskId: 'task-1', kind: 'assistant', text: 'The response explains what changed in the workspace and why the verification completed successfully.', metadata: {}, createdAt: '2026-01-01T00:01:00.000Z' },
      users[1]!,
      { id: 'assistant-2', taskId: 'task-1', kind: 'assistant', text: 'The second response belongs to the second turn and contains a longer explanation for the user.', metadata: {}, createdAt: '2026-01-01T00:02:00.000Z' },
    ];
    const view = render(<ConversationTimeline activities={activities} onSelect={() => undefined} viewportRef={viewportRef} />);
    const markers = view.container.querySelectorAll<HTMLButtonElement>('.conversation-timeline-marker');

    fireEvent.mouseEnter(markers[0]!);

    expect(view.container.querySelector('.conversation-timeline-preview-user')?.textContent).toBe(formatTextClamp(60, 'Message 1'));
    expect(view.container.querySelector('.conversation-timeline-preview-agent')?.textContent).toBe(formatTextClamp(96, 'The response explains what changed in the workspace and why the verification completed successfully.'));

    fireEvent.mouseLeave(markers[0]!);
    fireEvent.mouseEnter(markers[1]!);
    expect(view.container.querySelector('.conversation-timeline-preview-user')?.textContent).toBe('Message 2');
    expect(view.container.querySelector('.conversation-timeline-preview-agent')?.textContent).toBe(formatTextClamp(96, 'The second response belongs to the second turn and contains a longer explanation for the user.'));
  });
});
