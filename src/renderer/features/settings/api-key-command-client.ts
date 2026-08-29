import { executeDesktopCommandResult, type DesktopCommandInvocation } from '../../services/desktop-command-client.js';

export const AUTH_STATUS_ACTION = 'auth.status';
export const AUTH_LOGIN_ACTION = 'auth.login.direct';
export const AUTH_LOGOUT_ACTION = 'auth.logout';

export async function readApiKeyStatus(cwd: string): Promise<boolean> {
  const result = await executeDesktopCommandResult(cwd, command(AUTH_STATUS_ACTION));
  const value: unknown = JSON.parse(result.content);
  if (typeof value !== 'object' || value === null || typeof (value as Record<string, unknown>)['authenticated'] !== 'boolean') {
    throw new Error('The CLI returned an invalid authentication status.');
  }
  return (value as Record<string, unknown>)['authenticated'] === true;
}

export function saveApiKey(cwd: string, apiKey: string): Promise<void> {
  return executeDesktopCommandResult(cwd, { ...command(AUTH_LOGIN_ACTION), secrets: { apiKey } }).then(() => undefined);
}

export function removeApiKey(cwd: string): Promise<void> {
  return executeDesktopCommandResult(cwd, command(AUTH_LOGOUT_ACTION)).then(() => undefined);
}

function command(actionId: string): DesktopCommandInvocation { return { actionId, positionals: [], options: {} }; }
