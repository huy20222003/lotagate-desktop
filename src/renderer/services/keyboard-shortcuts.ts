import { useCallback, useEffect, useRef, useState } from 'react';

export type KeyboardShortcutAction = 'newSession' | 'openWorkspace' | 'openSettings' | 'focusPrompt' | 'archiveSession' | 'cancelResponse' | 'toggleChangedFiles';
export interface KeyboardShortcutDefinition { action: KeyboardShortcutAction; label: string; description: string; defaultShortcut: string | null; }
export type KeyboardShortcutBindings = Partial<Record<KeyboardShortcutAction, string | null>>;

export const KEYBOARD_SHORTCUT_DEFINITIONS: readonly KeyboardShortcutDefinition[] = [
  { action: 'newSession', label: 'New chat', description: 'Start a new chat in the current workspace.', defaultShortcut: 'Ctrl+N' },
  { action: 'openWorkspace', label: 'Open workspace', description: 'Choose a workspace from the local machine.', defaultShortcut: 'Ctrl+O' },
  { action: 'openSettings', label: 'Open settings', description: 'Open the desktop settings.', defaultShortcut: 'Ctrl+,' },
  { action: 'focusPrompt', label: 'Focus prompt', description: 'Move focus to the chat prompt.', defaultShortcut: 'Ctrl+L' },
  { action: 'archiveSession', label: 'Archive session', description: 'Archive the currently selected session.', defaultShortcut: 'Ctrl+Shift+A' },
  { action: 'cancelResponse', label: 'Cancel response', description: 'Stop the active agent response.', defaultShortcut: 'Ctrl+Escape' },
  { action: 'toggleChangedFiles', label: 'Toggle changed files', description: 'Open the changed files drawer for the current response.', defaultShortcut: 'Ctrl+Shift+D' },
];

export function useKeyboardShortcuts(actions: Partial<Record<KeyboardShortcutAction, () => void>>): { bindings: KeyboardShortcutBindings; updateShortcut: (action: KeyboardShortcutAction, shortcut: string | null) => Promise<void> } {
  const [bindings, setBindings] = useState<KeyboardShortcutBindings>(() => Object.fromEntries(KEYBOARD_SHORTCUT_DEFINITIONS.map(definition => [definition.action, definition.defaultShortcut])) as KeyboardShortcutBindings);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    let mounted = true;
    void window.lotagate.settings.get().then(settings => {
      if (!mounted) return;
      const stored = settings['keyboardShortcuts'];
      if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return;
      setBindings(current => ({ ...current, ...Object.fromEntries(Object.entries(stored).filter(([action, shortcut]) => KEYBOARD_SHORTCUT_DEFINITIONS.some(definition => definition.action === action) && (shortcut === null || typeof shortcut === 'string'))) }));
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const match = KEYBOARD_SHORTCUT_DEFINITIONS.find(definition => {
        const shortcut = bindings[definition.action];
        return shortcut !== null && shortcut !== undefined && matchesShortcut(event, shortcut);
      });
      if (!match) return;
      event.preventDefault();
      actionsRef.current[match.action]?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bindings]);
  const updateShortcut = useCallback(async (action: KeyboardShortcutAction, shortcut: string | null) => {
    const next = { ...bindings, [action]: shortcut };
    await window.lotagate.settings.update({ keyboardShortcuts: next });
    setBindings(next);
  }, [bindings]);
  return { bindings, updateShortcut };
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+').map(part => part.trim().toLocaleLowerCase()).filter(Boolean);
  const key = parts.at(-1);
  if (!key || normalizeKey(event.key) !== normalizeKey(key)) return false;
  return parts.includes('ctrl') === event.ctrlKey && parts.includes('alt') === event.altKey && parts.includes('shift') === event.shiftKey && parts.includes('meta') === event.metaKey;
}

export function formatShortcutEvent(event: KeyboardEvent): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null;
  const parts = [event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Meta' : '', displayKey(event.key)].filter(Boolean);
  return parts.join('+');
}

function normalizeKey(value: string): string { return value.toLocaleLowerCase() === ' ' ? 'space' : value.toLocaleLowerCase(); }
function displayKey(value: string): string { return value.length === 1 ? value.toLocaleUpperCase() : value === ' ' ? 'Space' : value; }
function isEditableTarget(target: EventTarget | null): boolean { const element = target instanceof HTMLElement ? target : null; return element?.matches('input, textarea, select, [contenteditable="true"]') ?? false; }
