export type ComputerApplicationPlatform = 'win32' | 'darwin' | 'linux';

/**
 * These are conservative GUI-only defaults. Shells, scripting hosts,
 * debuggers, task managers, and administrative tools are intentionally not
 * included. Users can still add an application name or executable path when
 * they explicitly want Computer Use to launch it.
 */
export const DEFAULT_COMPUTER_APPLICATION_ALLOWLIST_BY_PLATFORM = {
  win32: [
    'notepad.exe', 'calc.exe', 'mspaint.exe', 'explorer.exe',
    'charmap.exe', 'snippingtool.exe', 'write.exe', 'magnify.exe', 'osk.exe', 'narrator.exe', 'winver.exe',
  ],
  darwin: [
    'Finder', 'TextEdit', 'Preview', 'Calculator', 'Calendar', 'Notes', 'Stickies', 'Font Book', 'Image Capture', 'Dictionary',
  ],
  linux: [
    'nautilus', 'dolphin', 'thunar', 'pcmanfm', 'gedit', 'kate', 'mousepad', 'xed', 'evince', 'okular', 'eog', 'loupe', 'gnome-calculator', 'kcalc', 'xcalc',
  ],
} as const satisfies Record<ComputerApplicationPlatform, readonly string[]>;

/** Default export retained for renderer fallbacks and Windows development. */
export const DEFAULT_COMPUTER_APPLICATION_ALLOWLIST = DEFAULT_COMPUTER_APPLICATION_ALLOWLIST_BY_PLATFORM.win32;

export function defaultComputerApplicationAllowlist(platform: ComputerApplicationPlatform): readonly string[] {
  return DEFAULT_COMPUTER_APPLICATION_ALLOWLIST_BY_PLATFORM[platform];
}

/** Accepts the comma-separated value used by the settings textarea. */
export function normalizeComputerApplicationAllowlist(values: readonly string[]): string[] {
  return [...new Set(values.flatMap(value => value.split(/[\r\n,]+/u).map(item => item.trim()).filter(Boolean)))];
}

/** Application identifiers are compared case-insensitively with an optional Windows suffix. */
export function computerApplicationKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\.exe$/u, '');
}

export function isComputerApplicationAllowed(application: string, allowlist: readonly string[]): boolean {
  const key = computerApplicationKey(application);
  return key.length > 0 && allowlist.some(item => computerApplicationKey(item) === key);
}
