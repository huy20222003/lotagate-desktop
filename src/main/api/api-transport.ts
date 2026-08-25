import { session, type Session } from 'electron';
import { API_AUTH_COOKIES, API_CRYPTO, API_PATHS, isDesktopApiPathAllowed } from './api-contract.js';
import { bootstrapCryptoSession, decryptJson, encryptJson, isEnvelope, nextContext, shouldRotate, type ApiCryptoSession, type EcPublicJwk } from './api-crypto.js';

export interface ApiTransportConfig {
  baseUrl: string;
  trustedOrigin: string;
  partition: string;
  onSessionExpired?: () => void;
}

export interface ApiErrorPayload {
  message?: string;
  error?: { message?: string; code?: string };
  errorCode?: string;
}

export interface ApiRequestOptions {
  retryOnUnauthorized?: boolean;
}

export class DesktopApiError extends Error {
  constructor(readonly status: number, message: string, readonly retryable = status >= 500) {
    super(message);
    this.name = 'DesktopApiError';
  }
}

export class ApiTransport {
  private readonly apiSession: Session;
  private cryptoSession: ApiCryptoSession | null = null;
  private refreshOperation: Promise<void> | undefined;

  constructor(private readonly config: ApiTransportConfig) {
    this.apiSession = session.fromPartition(config.partition, { cache: true });
  }

  async request<T>(path: string, method: string, body?: unknown, options: ApiRequestOptions = {}): Promise<T> {
    this.assertAllowed(path);
    if (!this.config.baseUrl || !this.config.trustedOrigin) throw new DesktopApiError(0, 'The LotaGate API URL and trusted origin must be configured.', false);
    try { return await this.requestOnce<T>(path, method, body); }
    catch (error) {
      if (options.retryOnUnauthorized === false || !(error instanceof DesktopApiError) || error.status !== 401 || new Set<string>([API_PATHS.login, API_PATHS.refresh, API_PATHS.cryptoSession, API_PATHS.logout]).has(path)) throw error;
      await this.refreshSession();
      try {
        return await this.requestOnce<T>(path, method, body);
      } catch (retryError) {
        if (retryError instanceof DesktopApiError && retryError.status === 401) await this.expireSession();
        throw retryError;
      }
    }
  }

  async clearSession(): Promise<void> {
    this.cryptoSession = null;
    await this.apiSession.clearStorageData({ storages: ['cookies'] });
  }

  async restoreSession(): Promise<boolean> {
    if (!this.config.baseUrl || !this.config.trustedOrigin) throw new DesktopApiError(0, 'The LotaGate API URL and trusted origin must be configured.', false);
    const cookies = await this.apiSession.cookies.get({ url: this.config.baseUrl });
    const hasAccessCookie = cookies.some(cookie => cookie.name === API_AUTH_COOKIES.access);
    const hasRefreshCookie = cookies.some(cookie => cookie.name === API_AUTH_COOKIES.refresh);
    if (!hasAccessCookie && !hasRefreshCookie) return false;
    if (hasAccessCookie) {
      try {
        await this.requestOnce(API_PATHS.me, 'GET');
        return true;
      } catch (error) {
        if (!(error instanceof DesktopApiError) || error.status !== 401) throw error;
      }
    }
    if (!hasRefreshCookie) {
      await this.clearSession();
      return false;
    }
    try {
      await this.requestOnce(API_PATHS.refresh, 'POST');
      this.cryptoSession = null;
      return true;
    } catch (error) {
      if (error instanceof DesktopApiError && error.status === 401) {
        await this.expireSession();
        return false;
      }
      throw error;
    }
  }

  private async requestOnce<T>(path: string, method: string, body?: unknown): Promise<T> {
    const url = this.resolveUrl(path);
    if (path === API_PATHS.cryptoSession) return this.send<T>(url, method, body);
    const crypto = await this.ensureCryptoSession();
    const context = nextContext(crypto, method, new URL(url).pathname);
    const encryptedBody = body === undefined ? undefined : await encryptJson(body, crypto, context);
    const response = await this.send<unknown>(url, method, encryptedBody, context);
    if (isEnvelope(response)) return unwrapPayload(await decryptJson<ApiEnvelope<T>>(response, crypto, context));
    return response as T;
  }

  private async refreshSession(): Promise<void> {
    if (this.refreshOperation !== undefined) return this.refreshOperation;
    this.refreshOperation = (async () => {
      try {
        await this.requestOnce(API_PATHS.refresh, 'POST');
        this.cryptoSession = null;
      } catch (error) {
        await this.expireSession();
        throw error;
      } finally { this.refreshOperation = undefined; }
    })();
    return this.refreshOperation;
  }

  private async expireSession(): Promise<void> {
    await this.clearSession();
    this.config.onSessionExpired?.();
  }

  private async ensureCryptoSession(): Promise<ApiCryptoSession> {
    if (!shouldRotate(this.cryptoSession)) return this.cryptoSession as ApiCryptoSession;
    this.cryptoSession = await bootstrapCryptoSession((publicKey) => this.send<{
      kid: string;
      salt: string;
      serverPublicKey: EcPublicJwk;
      expiresAt: number;
    }>(this.resolveUrl(API_PATHS.cryptoSession), 'POST', publicKey));
    return this.cryptoSession;
  }

  private async send<T>(url: string, method: string, body?: unknown, context?: { kid: string; ts: number; seq: number; rid: string }): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Origin: this.config.trustedOrigin,
      Referer: `${new URL(this.config.trustedOrigin).origin}/`,
      'Sec-Fetch-Site': resolveFetchSite(this.config.baseUrl, this.config.trustedOrigin),
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (context) {
      headers[API_CRYPTO.keyIdHeader] = context.kid;
      headers[API_CRYPTO.timestampHeader] = String(context.ts);
      headers[API_CRYPTO.sequenceHeader] = String(context.seq);
      headers[API_CRYPTO.requestIdHeader] = context.rid;
    }
    const csrf = await this.readCsrfCookie();
    if (csrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) headers[API_CRYPTO.csrfHeaderName] = csrf;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    let response: Response;
    try {
      response = await this.apiSession.fetch(url, {
        method: method.toUpperCase(),
        headers,
        credentials: 'include',
        ...(payload === undefined ? {} : { body: payload }),
      });
    } catch (error) {
      throw new DesktopApiError(0, error instanceof Error ? error.message : 'The LotaGate API request failed.', true);
    }
    const result = { status: response.status, text: await response.text() };
    const parsed = parseResponse(result.text);
    if (result.status < 200 || result.status >= 300) {
      const error = parsed as ApiErrorPayload | undefined;
      throw new DesktopApiError(result.status, error?.error?.message ?? error?.message ?? 'API request failed.');
    }
    return parsed as T;
  }

  private async readCsrfCookie(): Promise<string | null> {
    if (!this.config.baseUrl) return null;
    const cookies = await this.apiSession.cookies.get({ url: this.config.baseUrl, name: API_CRYPTO.csrfCookieName });
    return cookies[0]?.value ?? null;
  }

  private resolveUrl(path: string): string {
    const base = this.config.baseUrl.endsWith('/') ? this.config.baseUrl : `${this.config.baseUrl}/`;
    return new URL(path.replace(/^\//, ''), base).toString();
  }

  private assertAllowed(path: string): void {
    if (!isDesktopApiPathAllowed(path) || path.startsWith('/admin')) throw new DesktopApiError(403, `Desktop API route is not allowlisted: ${path}`, false);
  }
}

interface ApiEnvelope<T> {
  data: T;
}

function unwrapPayload<T>(payload: ApiEnvelope<T>): T {
  return payload.data;
}

function parseResponse(text: string): unknown {
  if (text.trim().length === 0) return undefined;
  try {
    const value = JSON.parse(text) as { data?: unknown };
    return value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
  } catch {
    throw new DesktopApiError(502, 'The API returned an invalid JSON response.', true);
  }
}

function resolveFetchSite(apiBaseUrl: string, trustedOrigin: string): 'same-site' | 'cross-site' {
  const apiHost = new URL(apiBaseUrl).hostname.toLowerCase();
  const trustedHost = new URL(trustedOrigin).hostname.toLowerCase();
  const sameSite = apiHost === trustedHost || apiHost.endsWith(`.${trustedHost}`) || trustedHost.endsWith(`.${apiHost}`);
  return sameSite ? 'same-site' : 'cross-site';
}
