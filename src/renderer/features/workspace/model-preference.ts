const SELECTED_MODEL_STORAGE_KEY = 'lotagate.desktop.selected-model';

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
