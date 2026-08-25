const READ_ONLY_COMMAND_PATTERN = /\b(?:read[_ -]?file|read file|get-content|cat|type|head|tail|sed|grep|rg|ls|dir|pwd)\b/iu;
const READ_ONLY_GIT_PATTERN = /\bgit\s+(?:status|diff|log|show|rev-parse)\b/iu;

export function isReadOnlyCommand(command: string, args: readonly string[] = []): boolean {
  const text = [command, ...args].join(' ');
  return READ_ONLY_COMMAND_PATTERN.test(text) || READ_ONLY_GIT_PATTERN.test(text);
}
