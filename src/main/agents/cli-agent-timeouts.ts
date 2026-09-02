const CLI_REQUEST_TIMEOUTS_MS: Readonly<Record<string, number>> = {
  initialize: 15_000,
  'session.create': 15_000,
  'session.resume': 15_000,
  'title.generate': 30_000,
  'attachment.begin': 30_000,
  'attachment.chunk': 30_000,
  'attachment.complete': 30_000,
  'turn.start': 30_000,
  shutdown: 2_000,
};

export const CLI_DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const CLI_PROCESS_CLOSE_TIMEOUT_MS = 3_000;

export function cliRequestTimeout(method: string): number {
  return CLI_REQUEST_TIMEOUTS_MS[method] ?? CLI_DEFAULT_REQUEST_TIMEOUT_MS;
}
