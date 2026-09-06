import { loginInputSchema, userProfileSchema, type LoginInput, type UserProfile } from '../../contracts/ipc/v1/auth.js';
import { API_PATHS } from './api-contract.js';
import { ApiTransport, DesktopApiError } from './api-transport.js';

export class DesktopAuthService {
  constructor(private readonly transport: ApiTransport, private readonly stopAgents?: () => Promise<void>, private readonly resetUserContext?: () => void | Promise<void>) {}

  async getCurrentUser(): Promise<UserProfile | null> {
    try {
      const response = await this.transport.request<unknown>(API_PATHS.me, 'GET', undefined, { retryOnUnauthorized: false });
      return userProfileSchema.parse(response);
    } catch (error) {
      if (error instanceof DesktopApiError && error.status === 401) return null;
      throw error;
    }
  }

  async restoreSession(): Promise<UserProfile | null> {
    await this.resetUserContext?.();
    if (!(await this.transport.restoreSession())) return null;
    const profile = await this.getCurrentUser();
    if (profile) return profile;
    await this.clearSession();
    return null;
  }

  async login(input: LoginInput): Promise<UserProfile> {
    const credentials = loginInputSchema.parse(input);
    try {
      const response = await this.transport.request<{ loggedIn?: boolean; additionalAuthRequired?: boolean; twoFactorRequired?: boolean }>(API_PATHS.login, 'POST', credentials);
      if (response.additionalAuthRequired || response.twoFactorRequired || response.loggedIn !== true) throw new DesktopAuthError('AUTH_UNSUPPORTED', 'This account requires an authentication method that Desktop does not support.', false);
      const profile = await this.getCurrentUser();
      if (!profile) throw new DesktopAuthError('AUTH_REQUIRED', 'The server did not establish an authenticated session.', true);
      return profile;
    } catch (error) {
      if (error instanceof DesktopAuthError) throw error;
      if (error instanceof DesktopApiError && error.status === 401) throw new DesktopAuthError('AUTH_FAILED', 'The username or password is incorrect.', false);
      if (error instanceof DesktopApiError && error.status === 0) {
        const configuredError = error.message.includes('must be configured');
        throw new DesktopAuthError(configuredError ? 'API_NOT_CONFIGURED' : 'API_UNAVAILABLE', configuredError ? error.message : 'Unable to connect to the LotaGate API.', true);
      }
      if (error instanceof DesktopApiError && error.status === 429) throw new DesktopAuthError('AUTH_FAILED', 'Too many sign-in attempts. Please wait and try again.', true);
      if (error instanceof DesktopApiError && error.status >= 500) throw new DesktopAuthError('API_UNAVAILABLE', 'The LotaGate API is temporarily unavailable.', true);
      throw new DesktopAuthError('API_PROTOCOL_ERROR', 'The desktop could not validate the API response.', true);
    }
  }

  async logout(): Promise<void> {
    try {
      await this.stopAgents?.();
      await this.transport.request(API_PATHS.logout, 'POST');
    } catch (error) {
      // Logout is idempotent from the Desktop user's perspective. If the
      // access token is already expired or invalid, the server session is no
      // longer usable and local logout should still complete successfully.
      if (!(error instanceof DesktopApiError) || error.status !== 401) throw error;
    } finally {
      await this.clearSession();
    }
  }

  private async clearSession(): Promise<void> {
    await this.resetUserContext?.();
    await this.transport.clearSession();
  }
}

export class DesktopAuthError extends Error {
  constructor(readonly code: 'API_NOT_CONFIGURED' | 'AUTH_UNSUPPORTED' | 'AUTH_REQUIRED' | 'AUTH_FAILED' | 'API_UNAVAILABLE' | 'API_PROTOCOL_ERROR', message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'DesktopAuthError';
  }
}
