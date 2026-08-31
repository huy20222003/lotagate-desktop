const READ_ONLY_EXECUTABLES = new Set([
  'read-file', 'read_file', 'get-content', 'cat', 'type', 'more', 'head', 'tail', 'sed', 'rg', 'grep', 'ls', 'dir', 'pwd', 'where', 'which', 'stat', 'wc', 'uniq', 'file',
]);

const READ_ONLY_GIT_COMMANDS = new Set(['status', 'diff', 'log', 'show', 'branch', 'tag', 'remote', 'rev-parse', 'ls-files']);
const MUTATING_GIT_FLAGS = new Set(['-d', '-D', '-m', '-M', '-c', '-C', '--delete', '--move', '--force', '--unset-upstream']);
const MUTATING_GIT_SUBCOMMANDS = new Set(['add', 'remove', 'rename', 'set-url', 'set-head', 'delete', '-d']);
const GIT_GLOBAL_EXECUTION_FLAGS = new Set(['-c', '--config-env', '--exec-path']);
const GIT_UNSAFE_READ_FLAGS = new Set(['-o', '--output', '--ext-diff', '--textconv']);
const READ_ONLY_TOOL_NAMES = new Set([
  'filesystem.read', 'filesystem.list', 'filesystem.exists',
  'git.status', 'git.diff', 'git.log', 'git.show', 'git.rev-parse',
  'browser.inspect', 'browser.inspectElement', 'browser.console', 'browser.network', 'browser.accessibility',
  'browser.screenshot', 'browser.readField', 'browser.tabs', 'browser.back', 'browser.forward', 'browser.reload', 'browser.waitFor',
  'skill.list', 'skill.load', 'agent.wait', 'work_plan.update',
]);

/** Classifies only an executable and argument vector, never display text. */
export function isReadOnlyCommand(command: string, args: readonly string[] = []): boolean {
  if (typeof command !== 'string' || !Array.isArray(args) || args.some(arg => typeof arg !== 'string')) return false;
  const executable = command.trim().split(/[\\/]/u).at(-1)?.toLowerCase().replace(/\.(?:exe|cmd|bat|ps1)$/u, '') ?? '';
  const normalizedArgs = args.map(value => value.toLowerCase());
  if (READ_ONLY_EXECUTABLES.has(executable)) return !containsUnsafeReadOnlyFlag(executable, normalizedArgs);
  return executable === 'git' && isReadOnlyGit(normalizedArgs);
}

/** Uses structured approval fields and refuses unknown or display-only data. */
export function isReadOnlyApproval(toolName: string, detail: Record<string, unknown>): boolean {
  if (READ_ONLY_TOOL_NAMES.has(toolName)) return true;
  if (toolName !== 'shell.exec' && toolName !== 'command') return false;
  const command = detail['command'];
  const args = detail['args'];
  return typeof command === 'string' && Array.isArray(args) && args.every(arg => typeof arg === 'string')
    && isReadOnlyCommand(command, args as string[]);
}

function isReadOnlyGit(args: readonly string[]): boolean {
  if (args.some(value => GIT_GLOBAL_EXECUTION_FLAGS.has(value) || value.startsWith('--config-env=') || value.startsWith('-c'))) return false;
  const subcommand = args.find(value => !value.startsWith('-'));
  if (subcommand === undefined || !READ_ONLY_GIT_COMMANDS.has(subcommand)) return false;
  if (args.some(value => MUTATING_GIT_FLAGS.has(value))) return false;
  if ((subcommand === 'remote' || subcommand === 'tag') && args.some(value => MUTATING_GIT_SUBCOMMANDS.has(value))) return false;
  const subcommandIndex = args.indexOf(subcommand);
  const trailing = args.slice(subcommandIndex + 1).filter(value => !value.startsWith('-'));
  if ((subcommand === 'branch' || subcommand === 'tag' || subcommand === 'remote') && trailing.length > 0) return false;
  return !args.some(value => GIT_UNSAFE_READ_FLAGS.has(value) || value.startsWith('--output='));
}

function containsUnsafeReadOnlyFlag(executable: string, args: readonly string[]): boolean {
  return executable === 'rg' && args.some(value => value === '--pre' || value.startsWith('--pre='));
}
