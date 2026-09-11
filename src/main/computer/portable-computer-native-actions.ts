import type { BoundedCommandResult } from '../process/bounded-command.js';
import { decodeLinuxWindowId, decodeMacElementId, decodeMacWindowId, encodeMacElementId, parseLinuxWindows, appleScriptString } from './portable-computer-codecs.js';
import type { PortableComputerCommands } from './portable-computer-command-resolver.js';

interface PortableComputerActionContext {
  readonly commands: PortableComputerCommands;
  readonly action: string;
  readonly params: Record<string, unknown>;
  readonly signal?: AbortSignal;
  readonly run: (command: string, args: readonly string[], signal?: AbortSignal, maxOutputBytes?: number, input?: string) => Promise<BoundedCommandResult>;
}

/** Runs the shared pointer/keyboard contract through the host's native desktop helper. */
export async function executePortableComputerNativeAction(context: PortableComputerActionContext): Promise<unknown | undefined> {
  if (context.commands.platform === 'linux' && context.commands.accessibility === 'linux-atspi') {
    const accessibilityResult = await executeLinuxAccessibility(context);
    if (accessibilityResult !== undefined) return accessibilityResult;
  }
  if (context.commands.platform === 'linux' && context.action === 'computer.setWindowState' && context.commands.listWindows === 'wmctrl') return setLinuxWindowState(context, optionalWindowId(context.params));
  if (context.commands.input === undefined) return undefined;
  return context.commands.input.mode === 'xdotool' ? executeLinuxInput(context) : executeMacAutomation(context);
}

async function executeLinuxAccessibility(context: PortableComputerActionContext): Promise<unknown | undefined> {
  const bridge = context.commands.accessibilityBridge;
  if (bridge === undefined || !context.action.startsWith('computer.')) return undefined;
  const supported = new Set(['computer.inspect', 'computer.focus', 'computer.click', 'computer.readText', 'computer.readSelection', 'computer.readGrid', 'computer.selectText', 'computer.setValue', 'computer.invoke', 'computer.select', 'computer.setToggleState', 'computer.setExpandedState', 'computer.scrollIntoView', 'computer.waitForState', 'computer.move', 'computer.drag']);
  if (!supported.has(context.action)) return undefined;
  if ((context.action === 'computer.click' || context.action === 'computer.move') && typeof context.params['elementId'] !== 'string') return undefined;
  if (context.action === 'computer.drag' && !hasElementDragTarget(context.params)) return undefined;
  const result = await context.run(bridge.command, [bridge.scriptPath], context.signal, 8 * 1024 * 1024, JSON.stringify({ action: context.action, params: { ...context.params, ...(context.commands.input === undefined ? {} : { inputCommand: context.commands.input.command }) } }));
  const parsed = parseJsonResult(result.stdout.toString('utf8'));
  if (parsed === undefined) throw new Error(`Linux accessibility bridge returned invalid JSON for ${context.action}.`);
  return parsed;
}

async function executeLinuxInput(context: PortableComputerActionContext): Promise<unknown | undefined> {
  const input = context.commands.input;
  if (input === undefined) return undefined;
  const windowId = optionalWindowId(context.params);
  const point = pointOf(context.params['point']);
  const run = (args: readonly string[], maxOutputBytes = 128 * 1024): Promise<BoundedCommandResult> => context.run(input.command, args, context.signal, maxOutputBytes);
  await activateLinuxWindow(run, input.command, windowId);
  const absolutePoint = await resolveLinuxPoint(context, point, windowId);
  if (context.action === 'computer.click') {
    if (point === undefined && typeof context.params['elementId'] !== 'string') throw new Error('Linux click requires a point or an inspected element target.');
    if (absolutePoint === undefined) throw new Error('Linux click requires a point when AT-SPI is unavailable.');
    await moveLinuxPointer(run, absolutePoint);
    const button = context.params['button'] === 'right' ? '3' : context.params['button'] === 'middle' ? '2' : '1';
    const count = integerParam(context.params['clickCount'], 1, 2);
    await run(['click', '--repeat', String(count), '--delay', '80', button]);
    return { clicked: true, point: absolutePoint, windowId };
  }
  if (context.action === 'computer.type') {
    const text = requiredString(context.params, 'text');
    if (text.length > 32_000) throw new Error('The text input is too large.');
    await run(['type', '--delay', '0', text], 512 * 1024);
    return { typed: true, characterCount: text.length, windowId };
  }
  if (context.action === 'computer.keypress') {
    const key = requiredString(context.params, 'key');
    const modifiers = Array.isArray(context.params['modifiers']) ? context.params['modifiers'].filter((value): value is string => typeof value === 'string') : [];
    const chord = [...modifiers.map(normalizeLinuxModifier), normalizeLinuxKey(key)].join('+');
    await run(['key', chord]);
    return { pressed: true, key, modifiers };
  }
  if (context.action === 'computer.scroll') {
    const deltaY = numberParam(context.params['deltaY']);
    const deltaX = numberParam(context.params['deltaX']);
    if (absolutePoint !== undefined) await moveLinuxPointer(run, absolutePoint);
    if (deltaY !== 0) await run(['click', '--repeat', String(Math.min(Math.abs(deltaY), 100)), deltaY > 0 ? '5' : '4']);
    if (deltaX !== 0) await run(['click', '--repeat', String(Math.min(Math.abs(deltaX), 100)), deltaX > 0 ? '7' : '6']);
    return { scrolled: true, deltaX, deltaY, windowId };
  }
  if (context.action === 'computer.move') {
    if (point === undefined && typeof context.params['elementId'] !== 'string') throw new Error('Linux move requires a point or an inspected element target.');
    if (absolutePoint === undefined) throw new Error('Linux move requires a point when AT-SPI is unavailable.');
    await moveLinuxPointer(run, absolutePoint);
    return { moved: true, point: absolutePoint, windowId };
  }
  if (context.action === 'computer.drag') {
    const from = await resolveLinuxPoint(context, pointOf(context.params['from']), windowId);
    const to = await resolveLinuxPoint(context, pointOf(context.params['to']), windowId);
    if (from === undefined || to === undefined) throw new Error('Linux drag requires point targets after UI inspection.');
    await moveLinuxPointer(run, from); await run(['mousedown', '1']); await moveLinuxPointer(run, to); await run(['mouseup', '1']);
    return { dragged: true, from, to, windowId };
  }
  if (context.action === 'computer.manageFileDialog') return manageLinuxFileDialog(context, run);
  return undefined;
}

async function resolveLinuxPoint(context: PortableComputerActionContext, point: { x: number; y: number } | undefined, windowId: string | undefined): Promise<{ x: number; y: number } | undefined> {
  if (point === undefined || windowId === undefined) return point;
  const bounds = await linuxWindowBounds(context, windowId);
  if (point.x < 0 || point.y < 0 || point.x >= bounds.width || point.y >= bounds.height) throw new Error('The Linux target point is outside the target window.');
  return { x: bounds.x + point.x, y: bounds.y + point.y };
}

async function linuxWindowBounds(context: PortableComputerActionContext, windowId: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const windowCommand = context.commands.listWindows === 'wmctrl' ? context.commands.listWindows : context.commands.input?.command === 'xdotool' ? context.commands.input.command : undefined;
  if (windowCommand === undefined) throw new Error('Linux relative pointer input requires window geometry support.');
  const id = decodeLinuxWindowId(windowId);
  const result = await context.run(windowCommand, windowCommand === 'wmctrl' ? ['-lG'] : ['getwindowgeometry', '--shell', id], context.signal, 2 * 1024 * 1024);
  if (windowCommand === 'wmctrl') {
    const target = parseLinuxWindows(result.stdout.toString('utf8')).find(item => item['windowId'] === windowId);
    const bounds = target?.['bounds'];
    if (isRecord(bounds) && typeof bounds['x'] === 'number' && typeof bounds['y'] === 'number' && typeof bounds['width'] === 'number' && typeof bounds['height'] === 'number') return bounds as { x: number; y: number; width: number; height: number };
  } else {
    const values = new Map(result.stdout.toString('utf8').split(/\r?\n/u).flatMap(line => { const match = /^([A-Z]+)=(-?\d+)$/u.exec(line); return match === null ? [] : [[match[1]!, Number(match[2])] as const]; }));
    const x = values.get('X'); const y = values.get('Y'); const width = values.get('WIDTH'); const height = values.get('HEIGHT');
    if ([x, y, width, height].every(value => value !== undefined)) return { x: x!, y: y!, width: width!, height: height! };
  }
  throw new Error(`The Linux window '${windowId}' was not found for pointer input.`);
}

async function setLinuxWindowState(context: PortableComputerActionContext, windowId: string | undefined): Promise<unknown> {
  if (windowId === undefined || context.commands.listWindows !== 'wmctrl') throw new Error('Linux window state changes require wmctrl and a windowId.');
  const id = decodeLinuxWindowId(windowId);
  const state = requiredString(context.params, 'state');
  if (!['normal', 'minimized', 'maximized'].includes(state)) throw new Error(`Unsupported Linux window state '${state}'.`);
  const args = state === 'maximized' ? ['-ir', id, '-b', 'add,maximized_vert,maximized_horz'] : state === 'minimized' ? ['-ir', id, '-b', 'add,hidden'] : ['-ir', id, '-b', 'remove,maximized_vert,maximized_horz,hidden'];
  await context.run(context.commands.listWindows, args, context.signal, 128 * 1024);
  return { state, windowId };
}

async function manageLinuxFileDialog(context: PortableComputerActionContext, run: (args: readonly string[]) => Promise<BoundedCommandResult>): Promise<unknown> {
  const action = requiredString(context.params, 'action');
  if (!['setPath', 'confirm', 'cancel'].includes(action)) throw new Error(`Unsupported Linux file dialog action '${action}'.`);
  const path = typeof context.params['path'] === 'string' ? context.params['path'] : undefined;
  if (action === 'setPath' || action === 'confirm') { if (path === undefined) throw new Error('A file dialog path is required.'); await run(['key', 'ctrl+l']); await run(['type', '--delay', '0', path]); }
  if (action === 'confirm') await run(['key', 'Return']);
  if (action === 'cancel') await run(['key', 'Escape']);
  return { action, ...(path === undefined ? {} : { path }), submitted: action !== 'setPath' };
}

async function executeMacAutomation(context: PortableComputerActionContext): Promise<unknown | undefined> {
  if (context.commands.accessibility !== undefined && (context.action === 'computer.inspect' || context.action === 'computer.readText' || context.action === 'computer.readSelection' || context.action === 'computer.readGrid' || context.action === 'computer.selectText' || context.action === 'computer.waitForState')) return executeMacAccessibility(context);
  const command = context.commands.input?.command;
  if (command === undefined) return undefined;
  if (context.action === 'computer.focus' || context.action === 'computer.click' || context.action === 'computer.type' || context.action === 'computer.keypress' || context.action === 'computer.move' || context.action === 'computer.drag' || context.action === 'computer.scroll' || context.action === 'computer.setValue' || context.action === 'computer.invoke' || context.action === 'computer.select' || context.action === 'computer.setToggleState' || context.action === 'computer.setExpandedState' || context.action === 'computer.scrollIntoView' || context.action === 'computer.manageFileDialog' || context.action === 'computer.setWindowState') {
    const script = macActionScript(context.action, context.params);
    const args = ['-e', script];
    const result = await context.run(command, args, context.signal, 512 * 1024);
    const parsed = parseJsonResult(result.stdout.toString('utf8'));
    if (parsed === undefined) throw new Error(`macOS automation returned invalid JSON for ${context.action}.`);
    return parsed;
  }
  return undefined;
}

async function executeMacAccessibility(context: PortableComputerActionContext): Promise<unknown> {
  const windowId = requiredString(context.params, 'windowId');
  const target = decodeMacWindowId(windowId);
  const element = typeof context.params['elementId'] === 'string' ? decodeMacElementId(context.params['elementId']) : undefined;
  if (element !== undefined && (element.application !== target.application || element.window !== target.window)) throw new Error('The inspected macOS element does not belong to the target window.');
  const script = macAccessibilityScript(context.action, context.params);
  const args = ['-e', script, '--', target.application, target.window, ...(element === undefined ? [] : [String(element.index)])];
  const result = await context.run('osascript', args, context.signal, 4 * 1024 * 1024);
  return parseMacAccessibilityResult(context.action, target.application, target.window, context.params, result.stdout.toString('utf8'));
}

function macActionScript(action: string, params: Record<string, unknown>): string {
  const point = pointOf(params['point']);
  const context = macWindowContext(params);
  const target = typeof params['elementId'] === 'string' ? macElementReference(params, context) : undefined;
  if (action === 'computer.click') return macClickScript(params, context, target, point);
  if (action === 'computer.move') return macMoveScript(params, context, target, point);
  if (action === 'computer.type') return macTypeScript(params, context, target);
  if (action === 'computer.keypress') return macKeypressScript(params, context);
  if (action === 'computer.focus') {
    if (target === undefined) throw new Error('macOS element focus requires an inspected element target.');
    return macElementOperation(context, `set value of attribute "AXFocused" of ${target} to true`, '{"focused":true}');
  }
  if (action === 'computer.scroll') return macScrollScript(params, context, point);
  if (action === 'computer.manageFileDialog') return macDialogScript(params, context);
  if (action === 'computer.drag') return macDragScript(params, context);
  if (action === 'computer.setWindowState') return macWindowStateScript(params);
  if (action === 'computer.setValue') return macElementOperation(context, `set value of ${target ?? 'first text field of front window'} to ${appleScriptString(requiredString(params, 'value'))}`, '{"set":true}');
  if (action === 'computer.invoke') return macElementOperation(context, `perform action "AXPress" of ${target ?? 'first button of front window'}`, '{"invoked":true}');
  if (action === 'computer.select') return macSelectScript(params, context, target);
  if (action === 'computer.setToggleState') return macToggleStateScript(params, target, context);
  if (action === 'computer.setExpandedState') return macExpandedStateScript(params, target, context);
  if (action === 'computer.scrollIntoView') return macElementOperation(context, `perform action "AXScrollToVisible" of ${target ?? 'first UI element of front window'}`, '{"scrolledIntoView":true}');
  return 'return "{}"';
}

function hasElementDragTarget(params: Record<string, unknown>): boolean {
  return isRecord(params['from']) && typeof params['from']['elementId'] === 'string' || isRecord(params['to']) && typeof params['to']['elementId'] === 'string';
}

function macAccessibilityScript(action: string, params: Record<string, unknown>): string {
  if (action === 'computer.inspect') {
    const maxDepth = typeof params['maxDepth'] === 'number' && Number.isFinite(params['maxDepth']) ? Math.max(1, Math.min(32, Math.trunc(params['maxDepth']))) : 8;
    return `on collectElements(parentElement, currentDepth, maximumDepth, currentIndex)\nset output to ""\nset indexValue to currentIndex\nrepeat with itemValue in UI elements of parentElement\nif indexValue ≥ 300 then exit repeat\ntry\nset roleValue to role of itemValue\nset nameValue to name of itemValue\nset valueValue to value of itemValue\nset output to output & indexValue & tab & roleValue & tab & nameValue & tab & valueValue & tab & currentDepth & linefeed\nset indexValue to indexValue + 1\nif currentDepth < maximumDepth then\nset nestedResult to my collectElements(itemValue, currentDepth + 1, maximumDepth, indexValue)\nset output to output & item 1 of nestedResult\nset indexValue to item 2 of nestedResult\nend if\nend try\nend repeat\nreturn {output, indexValue}\nend collectElements\non run argv\nset appName to item 1 of argv\nset windowName to item 2 of argv\ntell application "System Events"\ntell process appName\nset targetWindow to first window whose name is windowName\nset collected to my collectElements(targetWindow, 1, ${String(maxDepth)}, 0)\nreturn item 1 of collected\nend tell\nend tell\nend run`;
  }
  const index = typeof params['elementId'] === 'string' ? decodeMacElementId(params['elementId']).index : 0;
  if (action === 'computer.readText') {
    const scope = params['scope'] === 'selection' ? 'selection' : 'value';
    const expression = scope === 'selection' ? `value of attribute "AXSelectedText" of item ${index + 1} of entire contents` : `value of item ${index + 1} of entire contents`;
    return `on run argv\nset appName to item 1 of argv\nset windowName to item 2 of argv\ntell application "System Events" to tell process appName to tell first window whose name is windowName to return ${expression}\nend run`;
  }
  if (action === 'computer.readSelection') return `on run argv\nset appName to item 1 of argv\nset windowName to item 2 of argv\ntell application "System Events" to tell process appName to tell first window whose name is windowName\nset selectedValue to value of attribute "AXSelectedChildren" of item ${index + 1} of entire contents\nreturn selectedValue as text\nend tell\nend run`;
  if (action === 'computer.readGrid') return macGridScript(index, params);
  if (action === 'computer.selectText') return macSelectTextScript(index, params);
  if (action === 'computer.waitForState') return macWaitForStateScript(index, params);
  return 'return ""';
}

function parseMacAccessibilityResult(action: string, application: string, window: string, params: Record<string, unknown>, output: string): unknown {
  const element = typeof params['elementId'] === 'string' ? decodeMacElementId(params['elementId']) : undefined;
  const elementId = element === undefined ? encodeMacElementId(application, window, 0) : encodeMacElementId(application, window, element.index);
  if (action === 'computer.inspect') {
    const query = isRecord(params['query']) ? params['query'] : {};
    const role = typeof query['role'] === 'string' ? query['role'].toLocaleLowerCase() : undefined;
    const name = typeof query['name'] === 'string' ? query['name'].toLocaleLowerCase() : undefined;
    const text = typeof query['text'] === 'string' ? query['text'].toLocaleLowerCase() : undefined;
    const maxDepth = typeof params['maxDepth'] === 'number' && Number.isFinite(params['maxDepth']) ? Math.max(1, Math.min(32, Math.trunc(params['maxDepth']))) : 8;
    const elements = output.split(/\r?\n/u).filter(Boolean).map(line => {
      const [index, itemRole, itemName, value, depth] = line.split('\t');
      return { elementId: encodeMacElementId(application, window, Number(index)), role: itemRole ?? 'unknown', name: itemName ?? '', value: value ?? '', enabled: true, visible: true, depth: Number(depth ?? 0) };
    }).filter(item => (role === undefined || item.role.toLocaleLowerCase() === role) && (name === undefined || item.name.toLocaleLowerCase().includes(name)) && (text === undefined || `${item.name}\n${item.value}`.toLocaleLowerCase().includes(text))).filter(item => item.depth <= maxDepth);
    return { observationId: `${Date.now()}`, windowId: `mac:${Buffer.from(JSON.stringify({ application, window }), 'utf8').toString('base64url')}`, elements };
  }
  if (action === 'computer.readGrid') return { elementId, grid: output.trim().length === 0 ? [] : output.trim().split(/\r?\n/u).map(row => row.split('\t')) };
  if (action === 'computer.selectText') return { elementId, selected: true, text: output.trim() };
  if (action === 'computer.waitForState') return { elementId, condition: 'state', satisfied: true, value: output.trim() };
  if (action === 'computer.readSelection') return { elementId, items: output.trim().length === 0 ? [] : output.trim().split(/\r?\n/u) };
  if (action === 'computer.readText') {
    const scope = params['scope'] === 'selection' || params['scope'] === 'document' ? params['scope'] : 'value';
    return { elementId, scope, text: output.trim() };
  }
  return { elementId, text: output.trim(), items: output.trim().length === 0 ? [] : [output.trim()] };
}

interface MacWindowContext { readonly application: string; readonly window: string; }

function macWindowContext(params: Record<string, unknown>): MacWindowContext { return decodeMacWindowId(requiredString(params, 'windowId')); }

function macScript(context: MacWindowContext, body: string): string {
  return `tell application "System Events"\ntell process ${appleScriptString(context.application)}\nset frontmost to true\ntell window ${appleScriptString(context.window)}\n${body}\nend tell\nend tell\nend tell`;
}

function macElementOperation(context: MacWindowContext, operation: string, result: string): string {
  return macScript(context, `${operation}\nreturn ${appleScriptString(result)}`);
}

function macClickScript(params: Record<string, unknown>, context: MacWindowContext, target: string | undefined, point: { x: number; y: number } | undefined): string {
  if (target !== undefined) return macElementOperation(context, `perform action "AXPress" of ${target}`, '{"clicked":true}');
  if (point === undefined) throw new Error('macOS click requires a point or inspected element target.');
  const button = typeof params['button'] === 'string' ? params['button'] : 'left';
  if (button === 'middle') throw new Error('macOS System Events does not provide a native middle-click action.');
  if (button !== 'left' && button !== 'right') throw new Error('The mouse button is invalid.');
  const count = Math.max(1, Math.min(2, numberParam(params['clickCount']) || 1));
  const click = button === 'right' ? 'click at clickPoint using {control down}' : 'click at clickPoint';
  return macScript(context, `${macRelativePointScript(point, 'clickPoint')}\nrepeat ${String(count)} times\n${click}\nend repeat\nreturn ${appleScriptString('{"clicked":true}')}`);
}

function macMoveScript(_params: Record<string, unknown>, context: MacWindowContext, target: string | undefined, point: { x: number; y: number } | undefined): string {
  if (point !== undefined) return macElementOperation(context, `${macRelativePointScript(point, 'targetPoint')}\nmove mouse to targetPoint`, '{"moved":true}');
  if (target === undefined) throw new Error('macOS move requires a point or inspected element target.');
  return macElementOperation(context, `set targetElement to ${target}\nset targetPosition to position of targetElement\nset targetSize to size of targetElement\nmove mouse to {(item 1 of targetPosition) + ((item 1 of targetSize) / 2), (item 2 of targetPosition) + ((item 2 of targetSize) / 2)}`, '{"moved":true}');
}

function macTypeScript(params: Record<string, unknown>, context: MacWindowContext, target: string | undefined): string {
  const text = appleScriptString(requiredString(params, 'text'));
  const focus = target === undefined ? '' : `set value of attribute "AXFocused" of ${target} to true\n`;
  return macElementOperation(context, `${focus}keystroke ${text}`, '{"typed":true}');
}

function macKeypressScript(params: Record<string, unknown>, context: MacWindowContext): string {
  const key = requiredString(params, 'key');
  const keyCode = macKeyCode(key);
  const event = keyCode === undefined ? `keystroke ${appleScriptString(key)}` : `key code ${String(keyCode)}`;
  return macElementOperation(context, `${event}${macModifiers(params)}`, '{"pressed":true}');
}

function macSelectScript(params: Record<string, unknown>, context: MacWindowContext, target: string | undefined): string {
  if (target === undefined) throw new Error('macOS selection requires an inspected element target.');
  const mode = typeof params['mode'] === 'string' ? params['mode'] : 'replace';
  if (!['replace', 'add', 'remove'].includes(mode)) throw new Error('The selection mode is invalid.');
  const operation = mode === 'remove' ? `set value of attribute "AXSelected" of ${target} to false` : `perform action "AXSelect" of ${target}`;
  return macElementOperation(context, `${operation}\nif (value of attribute "AXSelected" of ${target} as text) is not ${appleScriptString(mode === 'remove' ? 'false' : 'true')} then error "The element did not reach the requested selection state."`, `{"selected":true,"mode":"${mode}"}`);
}

function macScrollScript(params: Record<string, unknown>, context: MacWindowContext, point: { x: number; y: number } | undefined): string {
  const vertical = numberParam(params['deltaY']);
  const horizontal = numberParam(params['deltaX']);
  if (vertical === 0 && horizontal === 0) return macElementOperation(context, '', '{"scrolled":true}');
  const location = point === undefined ? '' : ' at scrollPoint';
  const commands = [vertical === 0 ? '' : `scroll ${String(vertical)}${location}`, horizontal === 0 ? '' : `key down shift\nscroll ${String(horizontal)}${location}\nkey up shift`].filter(Boolean).join('\n');
  return macElementOperation(context, `${point === undefined ? '' : `${macRelativePointScript(point, 'scrollPoint')}\n`}${commands}`, '{"scrolled":true}');
}

function macDragScript(params: Record<string, unknown>, context: MacWindowContext): string {
  const from = macDragTarget(params['from'], context);
  const to = macDragTarget(params['to'], context);
  const duration = Math.max(0, Math.min(30, numberParam(params['durationMs']) / 1000));
  const fromScript = from.point === undefined ? `set sourceElement to ${from.element}\nset sourcePosition to position of sourceElement\nset sourceSize to size of sourceElement\nset fromPoint to {(item 1 of sourcePosition) + ((item 1 of sourceSize) / 2), (item 2 of sourcePosition) + ((item 2 of sourceSize) / 2)}` : macRelativePointScript(from.point, 'fromPoint');
  const toScript = to.point === undefined ? `set destinationElement to ${to.element}\nset destinationPosition to position of destinationElement\nset destinationSize to size of destinationElement\nset toPoint to {(item 1 of destinationPosition) + ((item 1 of destinationSize) / 2), (item 2 of destinationPosition) + ((item 2 of destinationSize) / 2)}` : macRelativePointScript(to.point, 'toPoint');
  return macScript(context, `${fromScript}\n${toScript}\nmove mouse to fromPoint\nmouse down\ndelay ${String(duration)}\nmove mouse to toPoint\nmouse up\nreturn ${appleScriptString('{"dragged":true}')}`);
}

function macRelativePointScript(point: { x: number; y: number }, variable: string): string {
  return `set windowPosition to position\nset ${variable} to {(item 1 of windowPosition) + ${String(point.x)}, (item 2 of windowPosition) + ${String(point.y)}}`;
}

function macWindowStateScript(params: Record<string, unknown>): string {
  const context = macWindowContext(params);
  const state = requiredString(params, 'state');
  const bounds = params['bounds'] === undefined ? undefined : macBounds(params['bounds']);
  const resize = bounds === undefined ? '' : `set position of targetWindow to {${String(bounds.x)}, ${String(bounds.y)}}\nset size of targetWindow to {${String(bounds.width)}, ${String(bounds.height)}}`;
  if (!['normal', 'minimized', 'maximized'].includes(state)) throw new Error('macOS window state must be normal, minimized, or maximized.');
  const stateScript = state === 'minimized' ? 'set value of attribute "AXMinimized" of targetWindow to true' : state === 'maximized' ? 'perform action "AXZoom" of targetWindow' : 'set value of attribute "AXMinimized" of targetWindow to false\ntry\nset value of attribute "AXFullScreen" of targetWindow to false\nend try';
  return macScript(context, `set targetWindow to window ${appleScriptString(context.window)}\n${stateScript}\n${resize}\nreturn ${appleScriptString(`{"state":"${state}"}`)}`);
}

function macToggleStateScript(params: Record<string, unknown>, target: string | undefined, context: MacWindowContext): string {
  const desired = requiredString(params, 'state');
  if (!['on', 'off', 'indeterminate'].includes(desired)) throw new Error('The toggle state is invalid.');
  const expected = desired === 'on' ? '1' : desired === 'off' ? '0' : '2';
  return macElementOperation(context, `set targetElement to ${target ?? 'first checkbox of front window'}\nrepeat 4 times\nset currentValue to value of attribute "AXValue" of targetElement\nif (currentValue as text) is ${appleScriptString(expected)} then return ${appleScriptString(`{"toggleState":"${desired}"}`)}\nperform action "AXPress" of targetElement\ndelay 0.1\nend repeat\nerror "The toggle did not reach the requested state."`, `{"toggleState":"${desired}"}`);
}

function macExpandedStateScript(params: Record<string, unknown>, target: string | undefined, context: MacWindowContext): string {
  const expanded = params['expanded'] === true;
  return macElementOperation(context, `set targetElement to ${target ?? 'first UI element of front window'}\nset value of attribute "AXExpanded" of targetElement to ${expanded ? 'true' : 'false'}\nif (value of attribute "AXExpanded" of targetElement as text) is not ${appleScriptString(expanded ? 'true' : 'false')} then error "The element did not reach the requested expanded state."`, `{"expanded":${String(expanded)}}`);
}

function macGridScript(index: number, params: Record<string, unknown>): string {
  const rowStart = Math.max(0, Math.trunc(numberParam(params['rowStart'])));
  const rowCount = Math.max(1, Math.min(100, Math.trunc(numberParam(params['rowCount']) || 100)));
  const columnStart = Math.max(0, Math.trunc(numberParam(params['columnStart'])));
  const columnCount = Math.max(1, Math.min(100, Math.trunc(numberParam(params['columnCount']) || 100)));
  return `on run argv\nset appName to item 1 of argv\nset windowName to item 2 of argv\ntell application "System Events" to tell process appName to tell first window whose name is windowName\nset gridElement to item ${index + 1} of entire contents\nset output to ""\nset rowIndex to 0\nrepeat with rowElement in rows of gridElement\nif rowIndex ≥ ${rowStart} and rowIndex < ${rowStart + rowCount} then\nset columnIndex to 0\nset rowOutput to ""\nrepeat with cellElement in UI elements of rowElement\nif columnIndex ≥ ${columnStart} and columnIndex < ${columnStart + columnCount} then\ntry\nset rowOutput to rowOutput & (value of cellElement as text) & tab\nend try\nend if\nset columnIndex to columnIndex + 1\nend repeat\nset output to output & rowOutput & linefeed\nend if\nset rowIndex to rowIndex + 1\nif rowIndex ≥ ${rowStart + rowCount} then exit repeat\nend repeat\nreturn output\nend tell\nend run`;
}

function macSelectTextScript(index: number, params: Record<string, unknown>): string {
  const text = appleScriptString(requiredString(params, 'text'));
  const occurrence = Math.max(1, Math.trunc(numberParam(params['occurrence']) || 1));
  return `on run argv\nset appName to item 1 of argv\nset windowName to item 2 of argv\ntell application "System Events" to tell process appName to tell first window whose name is windowName\nset targetElement to item ${index + 1} of entire contents\nset targetText to value of targetElement as text\nset needle to ${text}\nset searchStart to 1\nset matchStart to 0\nrepeat ${occurrence} times\nset matchStart to offset of needle in (text searchStart thru -1 of targetText)\nif matchStart is 0 then error "The requested text occurrence was not found."\nset searchStart to searchStart + matchStart + (length of needle) - 1\nend repeat\nset value of attribute "AXSelectedTextRange" of targetElement to {location:searchStart - (length of needle) - 1, length:length of needle}\nreturn needle\nend tell\nend run`;
}

function macWaitForStateScript(index: number, params: Record<string, unknown>): string {
  const property = requiredString(params, 'property');
  const expected = appleScriptString(requiredString(params, 'expected'));
  const attribute = property === 'isEnabled' ? 'AXEnabled' : property === 'isOffscreen' ? 'AXIsOffscreen' : property === 'toggleState' ? 'AXValue' : property === 'expandCollapseState' ? 'AXExpanded' : property === 'selectionState' ? 'AXSelected' : property === 'name' ? 'AXTitle' : 'AXValue';
  const timeout = Math.max(0, Math.min(120, numberParam(params['timeoutMs']) / 1000));
  const interval = Math.max(0.05, Math.min(2, numberParam(params['intervalMs']) / 1000 || 0.15));
  return `on run argv\nset appName to item 1 of argv\nset windowName to item 2 of argv\ntell application "System Events" to tell process appName to tell first window whose name is windowName\nset targetElement to item ${index + 1} of entire contents\nset deadline to (current date) + ${String(timeout)}\nrepeat\nset currentValue to value of attribute "${attribute}" of targetElement as text\nif currentValue is ${expected} then return currentValue\nif (current date) > deadline then error "The UI state wait timed out."\ndelay ${String(interval)}\nend repeat\nend tell\nend run`;
}

function macDialogScript(params: Record<string, unknown>, context: MacWindowContext): string {
  const action = requiredString(params, 'action');
  if (action === 'cancel') return macElementOperation(context, 'key code 53', '{"action":"cancel","submitted":true}');
  if (action === 'confirm') return macElementOperation(context, 'key code 36', '{"action":"confirm","submitted":true}');
  if (action !== 'setPath') throw new Error(`Unsupported macOS file dialog action '${action}'.`);
  const path = appleScriptString(requiredString(params, 'path'));
  return macElementOperation(context, `keystroke "g" using {command down}\ndelay 0.1\nkeystroke ${path}\nkey code 36`, '{"action":"setPath","submitted":false}');
}
function macModifiers(params: Record<string, unknown>): string {
  const modifiers = Array.isArray(params['modifiers']) ? params['modifiers'].filter((value): value is string => typeof value === 'string').map(normalizeMacModifier) : [];
  return modifiers.length === 0 ? '' : ` using {${modifiers.map(value => `${value} down`).join(', ')}}`;
}
function normalizeMacModifier(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === 'control' || normalized === 'ctrl') return 'control';
  if (normalized === 'alt' || normalized === 'option') return 'option';
  if (normalized === 'meta' || normalized === 'command' || normalized === 'cmd') return 'command';
  if (normalized === 'shift') return 'shift';
  throw new Error(`Unsupported macOS keyboard modifier '${value}'.`);
}
function macElementReference(params: Record<string, unknown>, context: MacWindowContext): string {
  const element = decodeMacElementId(String(params['elementId']));
  if (element.application !== context.application || element.window !== context.window) throw new Error('The inspected macOS element does not belong to the target window.');
  return `item ${element.index + 1} of entire contents`;
}
function macKeyCode(value: string): number | undefined {
  const normalized = value.toLowerCase().replace(/[\s_-]+/gu, '');
  return ({ enter: 36, return: 36, tab: 48, escape: 53, esc: 53, backspace: 51, delete: 117, home: 115, end: 119, pageup: 116, pagedown: 121, left: 123, right: 124, down: 125, up: 126, f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111 } as Record<string, number>)[normalized];
}
function macDragTarget(value: unknown, context: MacWindowContext): { point?: { x: number; y: number }; element?: string } {
  if (!isRecord(value)) throw new Error('macOS drag targets must be points or inspected elements.');
  const point = pointOf(value['point'] ?? value);
  if (point !== undefined) return { point };
  if (typeof value['elementId'] === 'string') return { element: macElementReference(value, context) };
  throw new Error('macOS drag targets must include a point or elementId.');
}
function macBounds(value: unknown): { x: number; y: number; width: number; height: number } {
  if (!isRecord(value) || !['x', 'y', 'width', 'height'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))) throw new Error('macOS window bounds require finite x, y, width, and height values.');
  const bounds = { x: Math.trunc(value['x'] as number), y: Math.trunc(value['y'] as number), width: Math.trunc(value['width'] as number), height: Math.trunc(value['height'] as number) };
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error('macOS window bounds must have positive dimensions.');
  return bounds;
}
async function activateLinuxWindow(run: (args: readonly string[]) => Promise<BoundedCommandResult>, command: string, windowId: string | undefined): Promise<void> {
  if (windowId !== undefined && command === 'xdotool') await run(['windowactivate', '--sync', decodeLinuxWindowId(windowId)]);
}
function optionalWindowId(params: Record<string, unknown>): string | undefined { return typeof params['windowId'] === 'string' && params['windowId'].length > 0 ? params['windowId'] : undefined; }
function pointOf(value: unknown): { x: number; y: number } | undefined { if (!isRecord(value) || typeof value['x'] !== 'number' || typeof value['y'] !== 'number') return undefined; return { x: Math.trunc(value['x']), y: Math.trunc(value['y']) }; }
function numberParam(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0; }
function integerParam(value: unknown, fallback: number, max: number): number { return typeof value === 'number' && Number.isInteger(value) ? Math.max(1, Math.min(max, value)) : fallback; }
function requiredString(params: Record<string, unknown>, key: string): string { const value = params[key]; if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} is required.`); return value; }
function normalizeLinuxModifier(value: string): string { return value.toLowerCase() === 'control' ? 'ctrl' : value.toLowerCase() === 'meta' ? 'super' : value.toLowerCase(); }
function normalizeLinuxKey(value: string): string { return value === 'Enter' ? 'Return' : value === 'Escape' ? 'Escape' : value; }
function moveLinuxPointer(run: (args: readonly string[]) => Promise<BoundedCommandResult>, point: { x: number; y: number }): Promise<BoundedCommandResult> { return run(['mousemove', '--sync', String(point.x), String(point.y)]); }
function parseJsonResult(value: string): unknown | undefined { try { return JSON.parse(value.trim()) as unknown; } catch { return undefined; } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
