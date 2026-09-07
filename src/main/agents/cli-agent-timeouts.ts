import { CLI_DEFAULT_REQUEST_TIMEOUT_MS, CLI_REQUEST_TIMEOUTS_MS } from './agent-constants.js';
export { CLI_DEFAULT_REQUEST_TIMEOUT_MS, CLI_PROCESS_CLOSE_TIMEOUT_MS } from './agent-constants.js';

export function cliRequestTimeout(method: string): number {
  return CLI_REQUEST_TIMEOUTS_MS[method] ?? CLI_DEFAULT_REQUEST_TIMEOUT_MS;
}
