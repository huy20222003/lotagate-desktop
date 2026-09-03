import { DESKTOP_REASONING_EFFORTS, type DesktopReasoningEffort } from '../../contracts/agent-protocol/v1/desktop.js';

const SELECTED_MODEL_STORAGE_KEY = 'lotagate.desktop.selected-model';
const SELECTED_EFFORT_STORAGE_KEY = 'lotagate.desktop.selected-effort';

export function readSelectedModel(): string | undefined {
  try {
    const value = window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY);
    return value?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function writeSelectedModel(model: string): void {
  try { window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, model); }
  catch { /* Storage can be unavailable in restricted renderer contexts. */ }
}

export function readSelectedEffort(): DesktopReasoningEffort | undefined {
  try {
    const value = window.localStorage.getItem(SELECTED_EFFORT_STORAGE_KEY);
    return DESKTOP_REASONING_EFFORTS.includes(value as DesktopReasoningEffort) ? value as DesktopReasoningEffort : undefined;
  } catch {
    return undefined;
  }
}

export function writeSelectedEffort(effort: DesktopReasoningEffort): void {
  try { window.localStorage.setItem(SELECTED_EFFORT_STORAGE_KEY, effort); }
  catch { /* Storage can be unavailable in restricted renderer contexts. */ }
}
