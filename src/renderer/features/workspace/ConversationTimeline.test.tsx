// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
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
  it('uses a stable viewport estimate when remounted before layout reports a height', () => {
    const viewportRef = { current: document.createElement('div') };
    const view = render(<ConversationTimeline activities={userActivities(10)} onSelect={() => undefined} viewportRef={viewportRef} />);

    expect(Array.from(view.container.querySelectorAll<HTMLButtonElement>('.conversation-timeline-marker')).map(marker => marker.style.top)).toEqual([
      '14px', '32px', '50px', '68px', '86px', '104px', '122px', '140px', '158px', '176px',
    ]);
  });
});
