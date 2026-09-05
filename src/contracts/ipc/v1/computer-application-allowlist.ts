/**
 * The default keeps the existing development experience while moving the
 * source of truth into Desktop settings. Users can remove every entry to
 * disable launching applications through Computer Use.
 */
export const DEFAULT_COMPUTER_APPLICATION_ALLOWLIST = ['notepad.exe', 'calc.exe', 'mspaint.exe', 'explorer.exe'] as const;

/** Accepts the comma-separated value used by the settings textarea. */
export function normalizeComputerApplicationAllowlist(values: readonly string[]): string[] {
  return [...new Set(values.flatMap(value => value.split(/[\r\n,]+/u).map(item => item.trim()).filter(Boolean)))];
}

/** Application identifiers are compared case-insensitively with an optional .exe suffix. */
export function computerApplicationKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\.exe$/u, '');
}

export function isComputerApplicationAllowed(application: string, allowlist: readonly string[]): boolean {
  const key = computerApplicationKey(application);
  return key.length > 0 && allowlist.some(item => computerApplicationKey(item) === key);
}
