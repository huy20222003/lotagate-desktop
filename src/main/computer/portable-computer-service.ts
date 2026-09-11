import { randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isComputerApplicationAllowed, normalizeComputerApplicationAllowlist } from '../../contracts/ipc/v1/computer-application-allowlist.js';
import type { DesktopHostCapability } from '../../contracts/agent-protocol/v1/host-capabilities.js';
import type { ComputerRuntime } from './computer-runtime.js';
import { COMPUTER_ACTION_TIMEOUT_MS, MAX_RESPONSE_BYTES } from './computer-constants.js';
import { runBoundedCommand } from '../process/bounded-command.js';
import { decodeLinuxWindowId, decodeMacWindowId, parseLinuxDisplays, parseLinuxWindows, parseMacWindows, appleScriptString } from './portable-computer-codecs.js';
import { displayArgs, listWindowsArgs, portableProviderName, resolvePortableComputerCommands, type PortableComputerCommands, type ScreenRegion } from './portable-computer-command-resolver.js';
import { buildPortableComputerCapability } from './portable-computer-capabilities.js';
import { executePortableComputerNativeAction } from './portable-computer-native-actions.js';
import { commandWorks, firstAvailableCommand } from '../process/command-availability.js';

export async function createPortableComputerService(getApplicationAllowlist: () => readonly string[] | Promise<readonly string[]>, linuxAccessibilityScript?: string): Promise<PortableComputerService> {
  let commands = await resolvePortableComputerCommands();
  if (commands.platform === 'linux' && commands.listWindows !== undefined && linuxAccessibilityScript !== undefined && await fileExists(linuxAccessibilityScript)) {
    const python = await firstAvailableCommand(['python3', 'python']);
    if (python !== undefined && await commandWorks(python, ['-c', 'import pyatspi'])) commands = { ...commands, accessibility: 'linux-atspi', accessibilityBridge: { command: python, scriptPath: linuxAccessibilityScript } };
  }
  return new PortableComputerService(commands, getApplicationAllowlist);
}

export class PortableComputerService implements ComputerRuntime {
  readonly capabilities: DesktopHostCapability;

  constructor(private readonly commands: PortableComputerCommands, private readonly getApplicationAllowlist: () => readonly string[] | Promise<readonly string[]>, private readonly timeoutMs = COMPUTER_ACTION_TIMEOUT_MS) {
    this.capabilities = buildPortableComputerCapability(portableProviderName(commands.platform), commands);
  }

  async execute(action: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    switch (action) {
      case 'computer.listWindows': return this.listWindows(signal);
      case 'computer.screenshot': return this.screenshot(params, signal);
      case 'computer.recognizeText': return this.recognizeText(params, signal);
      case 'computer.readClipboard': return this.readClipboard(signal);
      case 'computer.writeClipboard': return this.writeClipboard(params, signal);
      case 'computer.launch': return this.launch(params, signal);
      case 'computer.listDisplays': return this.listDisplays(signal);
      case 'computer.focus': return this.focus(params, signal);
      case 'computer.closeWindow': return this.windowAction('close', params, signal);
      case 'computer.wait': return this.wait(params, signal);
      default: {
        const result = await executePortableComputerNativeAction({ commands: this.commands, action, params, ...(signal === undefined ? {} : { signal }), run: (command, args, childSignal, maxOutputBytes = MAX_RESPONSE_BYTES, input) => this.run(command, args, childSignal, maxOutputBytes, input) });
        if (result !== undefined) return result;
        throw new Error(`The ${portableProviderName(this.commands.platform)} provider does not support ${action}.`);
      }
    }
  }

  private async listWindows(signal?: AbortSignal): Promise<unknown> {
    const command = this.commands.listWindows;
    if (command === undefined) throw new Error('Window enumeration is unavailable on this system.');
    const result = await this.run(command, listWindowsArgs(this.commands.platform), signal, 2 * 1024 * 1024);
    return this.commands.platform === 'darwin' ? parseMacWindows(result.stdout.toString('utf8')) : parseLinuxWindows(result.stdout.toString('utf8'));
  }

  private async screenshot(params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const capture = this.commands.screenshot;
    if (capture === undefined) throw new Error('Screen capture is unavailable on this system.');
    const root = await mkdtemp(join(tmpdir(), 'lotagate-computer-'));
    const path = join(root, `${randomUUID()}.png`);
    try {
      const region = await this.resolveCaptureRegion(params, signal);
      if (this.commands.platform === 'linux' && typeof params['windowId'] === 'string' && capture.command === 'gnome-screenshot') await this.run('wmctrl', ['-ia', decodeLinuxWindowId(String(params['windowId']))], signal, 128 * 1024);
      await this.run(capture.command, capture.args(path, region), signal, 16 * 1024);
      const data = await readFile(path);
      if (data.byteLength > MAX_RESPONSE_BYTES) throw new Error('Computer screenshot exceeded the supported size limit.');
      const dimensions = readPngDimensions(data);
      return { mimeType: 'image/png', ...dimensions, ...(region === undefined ? {} : { bounds: region }), dataBase64: data.toString('base64'), source: 'screen' };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  private async recognizeText(params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const capture = this.commands.screenshot;
    const ocr = this.commands.ocr;
    if (capture === undefined || ocr === undefined) throw new Error('Computer OCR requires a screen-capture utility and Tesseract.');
    const root = await mkdtemp(join(tmpdir(), 'lotagate-computer-ocr-'));
    const path = join(root, `${randomUUID()}.png`);
    try {
      const region = await this.resolveCaptureRegion(params, signal);
      if (this.commands.platform === 'linux' && typeof params['windowId'] === 'string' && capture.command === 'gnome-screenshot') await this.run('wmctrl', ['-ia', decodeLinuxWindowId(String(params['windowId']))], signal, 128 * 1024);
      await this.run(capture.command, capture.args(path, region), signal, 16 * 1024);
      const language = typeof params['language'] === 'string' && params['language'].trim().length > 0 ? params['language'].trim() : undefined;
      const result = await this.run(ocr, language === undefined ? [path, 'stdout'] : [path, 'stdout', '-l', language], signal, 4 * 1024 * 1024);
      return { text: result.stdout.toString('utf8').trim(), ...(region === undefined ? {} : { bounds: region }), source: 'screen', language: language ?? 'eng' };
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  private async readClipboard(signal?: AbortSignal): Promise<unknown> {
    const command = this.commands.clipboardRead;
    if (command === undefined) throw new Error('Text clipboard access is unavailable on this system.');
    const result = await this.run(command.command, command.args, signal, MAX_RESPONSE_BYTES);
    return { text: result.stdout.toString('utf8') };
  }

  private async writeClipboard(params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const command = this.commands.clipboardWrite;
    if (command === undefined) throw new Error('Text clipboard access is unavailable on this system.');
    const text = typeof params['text'] === 'string' ? params['text'] : undefined;
    if (text === undefined) throw new Error('Clipboard text is required.');
    await this.run(command.command, command.args, signal, MAX_RESPONSE_BYTES, text);
    return { written: true, characters: text.length };
  }

  private async launch(params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const command = this.commands.launch;
    if (command === undefined) throw new Error('Application launching is unavailable on this system.');
    const appId = typeof params['appId'] === 'string' ? params['appId'].trim() : '';
    if (!isComputerApplicationAllowed(appId, normalizeComputerApplicationAllowlist(await this.getApplicationAllowlist()))) throw new Error(`Application '${appId || 'unknown'}' is not allowlisted.`);
    const args = this.commands.platform === 'darwin' && !appId.includes('/') ? ['-a', appId] : [];
    await this.run(this.commands.platform === 'linux' ? appId : command, args, signal, 128 * 1024);
    return { launched: true, appId };
  }

  private async listDisplays(signal?: AbortSignal): Promise<unknown> {
    const command = this.commands.displays;
    if (command === undefined) throw new Error('Display enumeration is unavailable on this system.');
    const result = await this.run(command, displayArgs(this.commands.platform), signal, 2 * 1024 * 1024);
    if (this.commands.platform === 'darwin') {
      try { return { platform: 'macos', displays: JSON.parse(result.stdout.toString('utf8')) }; } catch { return { platform: 'macos', raw: result.stdout.toString('utf8') }; }
    }
    return { platform: 'linux', displays: parseLinuxDisplays(result.stdout.toString('utf8')) };
  }

  private async windowAction(action: 'focus' | 'close', params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const windowId = typeof params['windowId'] === 'string' ? params['windowId'] : '';
    if (windowId.length === 0) throw new Error('A windowId is required.');
    if (this.commands.platform === 'darwin') {
      const target = decodeMacWindowId(windowId);
      const script = action === 'focus'
        ? `tell application "System Events" to tell process ${appleScriptString(target.application)} to set frontmost to true`
        : `tell application "System Events" to tell process ${appleScriptString(target.application)} to perform action "AXPress" of (first button of window ${appleScriptString(target.window)} whose subrole is "AXCloseButton")`;
      await this.run('osascript', ['-e', script], signal, 128 * 1024);
      return { windowId, action };
    }
    const id = decodeLinuxWindowId(windowId);
    const command = this.commands.listWindows;
    if (command !== 'wmctrl') throw new Error(`Linux window ${action} requires wmctrl.`);
    await this.run(command, [action === 'focus' ? '-ia' : '-ic', id], signal, 128 * 1024);
    return { windowId, action };
  }

  private async focus(params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (typeof params['elementId'] !== 'string') return this.windowAction('focus', params, signal);
    const result = await executePortableComputerNativeAction({ commands: this.commands, action: 'computer.focus', params, ...(signal === undefined ? {} : { signal }), run: (command, args, childSignal, maxOutputBytes = MAX_RESPONSE_BYTES, input) => this.run(command, args, childSignal, maxOutputBytes, input) });
    if (result !== undefined) return result;
    throw new Error('Element focus is unavailable on this system.');
  }

  private async wait(params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const timeoutMs = typeof params['timeoutMs'] === 'number' && Number.isFinite(params['timeoutMs']) ? Math.max(0, Math.min(this.timeoutMs, Math.floor(params['timeoutMs']))) : 0;
    const condition = typeof params['condition'] === 'string' ? params['condition'] : 'idle';
    const startedAt = Date.now();
    const intervalMs = typeof params['intervalMs'] === 'number' && Number.isFinite(params['intervalMs']) ? Math.max(25, Math.min(2_000, Math.floor(params['intervalMs']))) : 150;
    while (Date.now() - startedAt <= timeoutMs) {
      if (await this.waitCondition(condition, params, signal)) return { condition, satisfied: true, elapsedMs: Date.now() - startedAt };
      await this.delay(intervalMs, signal);
    }
    throw new Error(`The computer wait condition '${condition}' timed out after ${String(timeoutMs)}ms.`);
  }

  private async waitCondition(condition: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<boolean> {
    if (condition === 'idle') return this.isIdle(params, signal);
    if (condition === 'window') {
      const windows = await this.listWindows(signal) as readonly Record<string, unknown>[];
      const target = typeof params['windowId'] === 'string' ? params['windowId'] : undefined;
      const text = typeof params['text'] === 'string' ? params['text'].toLocaleLowerCase() : undefined;
      return windows.some(window => (target === undefined || window['windowId'] === target) && (text === undefined || JSON.stringify(window).toLocaleLowerCase().includes(text)));
    }
    const windowId = typeof params['windowId'] === 'string' ? params['windowId'] : undefined;
    if (windowId === undefined) throw new Error(`The computer wait condition '${condition}' requires windowId.`);
    if (condition === 'text') {
      const text = typeof params['text'] === 'string' ? params['text'] : '';
      const inspected = await this.execute('computer.inspect', { windowId, query: { text }, maxDepth: 16 }, signal);
      return isRecord(inspected) && Array.isArray(inspected['elements']) && inspected['elements'].length > 0;
    }
    if (condition === 'element') {
      const elementId = typeof params['elementId'] === 'string' ? params['elementId'] : undefined;
      if (elementId === undefined) throw new Error('The element wait condition requires elementId.');
      try { await this.execute('computer.readText', { windowId, elementId }, signal); return true; } catch { return false; }
    }
    throw new Error(`The computer wait condition '${condition}' is not supported.`);
  }

  private async isIdle(params: Record<string, unknown>, signal?: AbortSignal): Promise<boolean> {
    const command = this.commands.idle;
    if (command === undefined) throw new Error('System idle detection is unavailable on this host.');
    const idleMs = typeof params['idleMs'] === 'number' && Number.isFinite(params['idleMs']) ? Math.max(0, params['idleMs']) : 0;
    const result = this.commands.platform === 'darwin'
      ? await this.run(command, ['-c', 'IOHIDSystem', '-d', '4'], signal, 512 * 1024)
      : await this.run(command, [], signal, 128 * 1024);
    const output = result.stdout.toString('utf8');
    const idle = this.commands.platform === 'darwin' ? Number(/HIDIdleTime\s*=\s*(\d+)/u.exec(output)?.[1] ?? 0) / 1_000_000 : Number.parseFloat(output.trim());
    return Number.isFinite(idle) && idle >= idleMs;
  }

  private async resolveCaptureRegion(params: Record<string, unknown>, signal?: AbortSignal): Promise<ScreenRegion | undefined> {
    const explicit = parseRegion(params['region']);
    const windowId = typeof params['windowId'] === 'string' ? params['windowId'] : undefined;
    if (windowId === undefined) return explicit;
    const bounds = this.commands.platform === 'darwin' ? await this.macWindowBounds(windowId, signal) : await this.linuxWindowBounds(windowId, signal);
    if (explicit === undefined) return bounds;
    const region = { x: bounds.x + explicit.x, y: bounds.y + explicit.y, width: explicit.width, height: explicit.height };
    assertRegion(region);
    return region;
  }

  private async macWindowBounds(windowId: string, signal?: AbortSignal): Promise<ScreenRegion> {
    const target = decodeMacWindowId(windowId);
    const script = `tell application "System Events" to tell process ${appleScriptString(target.application)} to tell window ${appleScriptString(target.window)}\nset p to position\nset s to size\nreturn (item 1 of p) & tab & (item 2 of p) & tab & (item 1 of s) & tab & (item 2 of s)\nend tell`;
    const result = await this.run('osascript', ['-e', script], signal, 128 * 1024);
    return parseRegionText(result.stdout.toString('utf8'));
  }

  private async linuxWindowBounds(windowId: string, signal?: AbortSignal): Promise<ScreenRegion> {
    if (this.commands.listWindows !== 'wmctrl') throw new Error('Linux window capture requires wmctrl.');
    const result = await this.run('wmctrl', ['-lG'], signal, 2 * 1024 * 1024);
    const id = decodeLinuxWindowId(windowId).slice(2).toLowerCase();
    const line = result.stdout.toString('utf8').split(/\r?\n/u).find(value => value.trim().split(/\s+/u)[0]?.toLowerCase() === id);
    if (line === undefined) throw new Error('The Linux window was not found for screen capture.');
    const fields = line.trim().split(/\s+/u);
    const bounds = fields.slice(2, 6).map(Number);
    if (bounds.length !== 4 || bounds.some(value => !Number.isFinite(value))) throw new Error('The Linux window geometry is invalid.');
    const [x, y, width, height] = bounds;
    return { x: x!, y: y!, width: width!, height: height! };
  }

  private delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
      const abort = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Computer action was cancelled.')); };
      if (signal?.aborted === true) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  private run(command: string, args: readonly string[], signal: AbortSignal | undefined, maxOutputBytes: number, input?: string): Promise<import('../process/bounded-command.js').BoundedCommandResult> {
    return runBoundedCommand(command, args, { ...(input === undefined ? {} : { input }), maxOutputBytes, timeoutMs: this.timeoutMs, ...(signal === undefined ? {} : { signal }) });
  }
}

async function fileExists(path: string): Promise<boolean> { try { await access(path); return true; } catch { return false; } }
function parseRegion(value: unknown): ScreenRegion | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value['x'] !== 'number' || typeof value['y'] !== 'number' || typeof value['width'] !== 'number' || typeof value['height'] !== 'number') throw new Error('The screen region must contain numeric x, y, width, and height values.');
  const region = { x: Math.trunc(value['x']), y: Math.trunc(value['y']), width: Math.trunc(value['width']), height: Math.trunc(value['height']) };
  assertRegion(region);
  return region;
}
function parseRegionText(value: string): ScreenRegion {
  const fields = value.trim().split(/\s+/u).map(Number);
  if (fields.length !== 4 || fields.some(item => !Number.isFinite(item))) throw new Error('The macOS window geometry is invalid.');
  const [x, y, width, height] = fields;
  const region = { x: x!, y: y!, width: width!, height: height! };
  assertRegion(region);
  return region;
}
function assertRegion(region: ScreenRegion): void { if (region.width <= 0 || region.height <= 0) throw new Error('The screen region must have positive dimensions.'); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function readPngDimensions(data: Buffer): { width: number; height: number } {
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47 || data.toString('ascii', 12, 16) !== 'IHDR') throw new Error('The screen capture utility returned an invalid PNG.');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
