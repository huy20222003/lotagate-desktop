import { describe, expect, it } from 'vitest';
import { paginateActivities } from './task-store.js';
import type { Activity } from '../../contracts/ipc/v1/workspace.js';

function activity(id: string): Activity {
  return { id, taskId: 'task-1', kind: 'user', text: id, metadata: {}, createdAt: `2026-01-01T00:00:0${id}Z` };
}

describe('paginateActivities', () => {
  const all = ['1', '2', '3', '4', '5'].map(activity);

  it('returns the newest page and a stable cursor for older messages', () => {
    expect(paginateActivities(all, { limit: 2 })).toEqual({ activities: all.slice(3), nextCursor: '4', hasMore: true });
  });

  it('returns the page before a cursor without including the cursor activity', () => {
    expect(paginateActivities(all, { limit: 2, before: '4' })).toEqual({ activities: all.slice(1, 3), nextCursor: '2', hasMore: true });
    expect(paginateActivities(all, { limit: 2, before: '2' })).toEqual({ activities: all.slice(0, 1), nextCursor: null, hasMore: false });
  });
});
