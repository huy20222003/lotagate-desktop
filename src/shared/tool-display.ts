/**
 * Canonical labels for the built-in tools exposed by the Desktop agent.
 *
 * Tool ids are protocol values and must remain stable. These labels are a
 * presentation concern, so they are deliberately kept outside the protocol
 * and shared by the main process and renderer wherever tool activity is shown.
 */
export const BUILTIN_TOOL_DISPLAY_NAMES = {
  'filesystem.read': 'Read file',
  'filesystem.list': 'List files',
  'filesystem.write': 'Write file',
  'filesystem.exists': 'Check file',
  'shell.exec': 'Run command',
  'skill.list': 'List skills',
  'skill.load': 'Load skill',
  'agent.spawn': 'Start subagent',
  'agent.wait': 'Wait for subagent',
  'agent.cancel': 'Cancel subagent',
  'browser.navigate': 'Open webpage',
  'browser.newTab': 'Open new tab',
  'browser.closeTab': 'Close browser tab',
  'browser.selectTab': 'Switch browser tab',
  'browser.inspect': 'Inspect webpage',
  'browser.screenshot': 'Capture screenshot',
  'browser.click': 'Click webpage element',
  'browser.focus': 'Focus webpage field',
  'browser.clear': 'Clear webpage field',
  'browser.hover': 'Hover webpage element',
  'browser.check': 'Set checkbox',
  'browser.select': 'Select option',
  'browser.readField': 'Read form field',
  'browser.type': 'Enter text',
  'browser.press': 'Press key',
  'browser.scroll': 'Scroll webpage',
  'browser.back': 'Go back',
  'browser.forward': 'Go forward',
  'browser.reload': 'Reload webpage',
  'browser.waitFor': 'Wait for webpage',
  'browser.tabs': 'List browser tabs',
} as const;

export function formatToolDisplayName(toolName: unknown, displayName: unknown): string {
  const normalizedToolName = normalize(toolName);
  const suppliedDisplayName = normalize(displayName);
  const builtInDisplayName = normalizedToolName === undefined
    ? undefined
    : BUILTIN_TOOL_DISPLAY_NAMES[normalizedToolName as keyof typeof BUILTIN_TOOL_DISPLAY_NAMES];
  if (suppliedDisplayName !== undefined && suppliedDisplayName !== normalizedToolName) return suppliedDisplayName;
  if (builtInDisplayName !== undefined) return builtInDisplayName;
  if (normalizedToolName?.startsWith('mcp__')) {
    const separator = normalizedToolName.lastIndexOf('__');
    return humanizeToolName(separator >= 0 ? normalizedToolName.slice(separator + 2) : normalizedToolName);
  }
  if (suppliedDisplayName !== undefined) return suppliedDisplayName;
  return normalizedToolName === undefined ? 'Tool' : humanizeToolName(normalizedToolName);
}

function normalize(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function humanizeToolName(value: string): string {
  return value
    .replace(/[_\-.]+/gu, ' ')
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\b\w/gu, character => character.toUpperCase());
}
