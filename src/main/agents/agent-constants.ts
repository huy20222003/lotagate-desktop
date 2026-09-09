import { cliExecutableName } from './cli-executable-name.js';

export const REQUIRED_DESKTOP_CAPABILITIES = ['execution-context', 'tool-allowlist', 'approval-reviews', 'lifecycle-controls', 'browser-host', 'execution-broker', 'intent-runtime', 'host-evidence', 'conversational-progress', 'local-memory-commands', 'extensions'] as const;
export const CLI_REQUEST_TIMEOUTS_MS: Readonly<Record<string, number>> = {
  initialize: 15_000,
  'session.create': 15_000,
  'session.resume': 15_000,
  'title.generate': 30_000,
  'attachment.begin': 30_000,
  'attachment.chunk': 30_000,
  'attachment.complete': 30_000,
  'attachment.delete': 30_000,
  'turn.start': 30_000,
  shutdown: 2_000,
};
export const CLI_DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const CLI_PROCESS_CLOSE_TIMEOUT_MS = 3_000;
export const CLI_PACKAGE_JSON = '@lotagate/cli/package.json';
export const CLI_EXECUTABLE = `bin/${cliExecutableName()}`;
export const CLI_NATIVE_EXECUTABLE = 'bin/lotagate.exe';
export const CLI_NODE_LAUNCHER = 'bin/lotagate.mjs';
