import { describe, expect, it } from 'vitest';
import { formatShortcutEvent, matchesShortcut } from './keyboard-shortcuts.js';

describe('keyboard shortcut service', () => {
  it('matches modifier combinations case-insensitively', () => {
    expect(matchesShortcut(keyEvent({ key: 'n', ctrlKey: true }), 'Ctrl+N')).toBe(true);
    expect(matchesShortcut(keyEvent({ key: 'n', ctrlKey: false }), 'Ctrl+N')).toBe(false);
  });

  it('formats a keyboard event as a persisted shortcut', () => {
    expect(formatShortcutEvent(keyEvent({ key: 'n', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+N');
    expect(formatShortcutEvent(keyEvent({ key: 'Control', ctrlKey: true }))).toBeNull();
  });
});

function keyEvent(values: { key: string; ctrlKey?: boolean; shiftKey?: boolean }): KeyboardEvent {
  return { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...values } as KeyboardEvent;
}
