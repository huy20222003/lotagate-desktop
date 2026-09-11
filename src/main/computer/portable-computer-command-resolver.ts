import { commandAvailable, firstAvailableCommand } from '../process/command-availability.js';

export type PortableComputerPlatform = 'darwin' | 'linux';
export type PortableComputerInputMode = 'osascript' | 'xdotool';

export interface PortableComputerCommands {
  readonly platform: PortableComputerPlatform;
  readonly listWindows?: string;
  readonly accessibility?: 'macos-system-events' | 'linux-atspi';
  readonly accessibilityBridge?: { command: string; scriptPath: string };
  readonly input?: { command: string; mode: PortableComputerInputMode };
  readonly screenshot?: { command: string; args: (path: string, region?: ScreenRegion) => readonly string[] };
  readonly ocr?: string;
  readonly clipboardRead?: { command: string; args: readonly string[] };
  readonly clipboardWrite?: { command: string; args: readonly string[] };
  readonly launch?: string;
  readonly displays?: string;
  readonly idle?: string;
}

export interface ScreenRegion { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }

export async function resolvePortableComputerCommands(): Promise<PortableComputerCommands> {
  if (process.platform === 'darwin') return resolveMacOSCommands();
  return resolveLinuxCommands();
}

export function portableProviderName(platform: PortableComputerPlatform): string {
  return platform === 'darwin' ? 'macos-system-automation' : 'linux-desktop-automation';
}

export function listWindowsArgs(platform: PortableComputerPlatform): readonly string[] {
  return platform === 'darwin'
    ? ['-e', 'tell application "System Events"\nset output to ""\nrepeat with appProcess in (every process whose background only is false)\nset appName to name of appProcess\nrepeat with appWindow in (every window of appProcess)\nset output to output & appName & tab & (name of appWindow) & linefeed\nend repeat\nend repeat\nreturn output\nend tell']
    : ['-l', '-G'];
}

export function displayArgs(platform: PortableComputerPlatform): readonly string[] {
  return platform === 'darwin' ? ['SPDisplaysDataType', '-json'] : ['--query'];
}

async function resolveMacOSCommands(): Promise<PortableComputerCommands> {
  const [osascript, screencapture, pbpaste, pbcopy, open, systemProfiler, tesseract, ioreg] = await Promise.all(['osascript', 'screencapture', 'pbpaste', 'pbcopy', 'open', 'system_profiler', 'tesseract', 'ioreg'].map(commandAvailable));
  return {
    platform: 'darwin',
    ...(osascript ? { listWindows: 'osascript' } : {}),
    ...(osascript ? { accessibility: 'macos-system-events' as const, input: { command: 'osascript', mode: 'osascript' as const } } : {}),
    ...(screencapture ? { screenshot: { command: 'screencapture', args: (path: string, region?: ScreenRegion) => region === undefined ? ['-x', '-o', path] : ['-x', '-o', '-R', `${region.x},${region.y},${region.width},${region.height}`, path] } } : {}),
    ...(tesseract ? { ocr: 'tesseract' } : {}),
    ...(pbpaste ? { clipboardRead: { command: 'pbpaste', args: [] } } : {}),
    ...(pbcopy ? { clipboardWrite: { command: 'pbcopy', args: [] } } : {}),
    ...(open ? { launch: 'open' } : {}),
    ...(systemProfiler ? { displays: 'system_profiler' } : {}),
    ...(ioreg ? { idle: 'ioreg' } : {}),
  };
}

async function resolveLinuxCommands(): Promise<PortableComputerCommands> {
  const [wmctrl, xdotool, xclip, xsel, wlPaste, wlCopy, xrandr, xdgOpen, screenshot, tesseract, xprintidle] = await Promise.all([
    commandAvailable('wmctrl'), commandAvailable('xdotool'), commandAvailable('xclip'), commandAvailable('xsel'), commandAvailable('wl-paste'), commandAvailable('wl-copy'), commandAvailable('xrandr'), commandAvailable('xdg-open'), firstAvailableCommand(['gnome-screenshot', 'scrot', 'grim']), commandAvailable('tesseract'), commandAvailable('xprintidle'),
  ]);
  const clipboardRead = xclip ? { command: 'xclip', args: ['-selection', 'clipboard', '-out'] } : xsel ? { command: 'xsel', args: ['--clipboard', '--output'] } : wlPaste ? { command: 'wl-paste', args: [] } : undefined;
  const clipboardWrite = xclip ? { command: 'xclip', args: ['-selection', 'clipboard'] } : xsel ? { command: 'xsel', args: ['--clipboard', '--input'] } : wlCopy ? { command: 'wl-copy', args: [] } : undefined;
  return {
    platform: 'linux',
    ...(wmctrl ? { listWindows: 'wmctrl' } : {}),
    ...(xdotool ? { input: { command: 'xdotool', mode: 'xdotool' as const } } : {}),
    ...(screenshot === undefined ? {} : { screenshot: { command: screenshot, args: (path: string, region?: ScreenRegion) => linuxScreenshotArgs(screenshot, path, region) } }),
    ...(tesseract ? { ocr: 'tesseract' } : {}),
    ...(clipboardRead === undefined ? {} : { clipboardRead }),
    ...(clipboardWrite === undefined ? {} : { clipboardWrite }),
    ...(xdgOpen ? { launch: 'xdg-open' } : {}),
    ...(xrandr ? { displays: 'xrandr' } : {}),
    ...(xprintidle ? { idle: 'xprintidle' } : {}),
  };
}

function linuxScreenshotArgs(command: string, path: string, region?: ScreenRegion): readonly string[] {
  if (command === 'scrot') return region === undefined ? [path] : ['-a', `${region.x},${region.y},${region.width},${region.height}`, path];
  if (command === 'grim') return region === undefined ? [path] : ['-g', `${region.x},${region.y} ${region.width}x${region.height}`, path];
  if (region !== undefined) throw new Error('The installed gnome-screenshot backend cannot capture an explicit region. Install scrot or grim for region capture.');
  return ['-f', path];
}
