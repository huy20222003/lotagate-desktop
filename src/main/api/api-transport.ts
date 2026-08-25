import { net, session, type Session } from 'electron';
import { API_CRYPTO, API_PATHS, isDesktopApiPathAllowed } from './api-contract.js';
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

  async request<T>(path: string, method: string, body?: unknown): Promise<T> {
    this.assertAllowed(path);
    if (!this.config.baseUrl || !this.config.trustedOrigin) throw new DesktopApiError(0, 'The LotaGate API URL and trusted origin must be configured.', false);
    try { return await this.requestOnce<T>(path, method, body); }
    catch (error) {
      if (!(error instanceof DesktopApiError) || error.status !== 401 || new Set<string>([API_PATHS.login, API_PATHS.refresh, API_PATHS.cryptoSession, API_PATHS.logout]).has(path)) throw error;
      await this.refreshSession();
      return this.requestOnce<T>(path, method, body);
    }
  }

  async clearSession(): Promise<void> {
    this.cryptoSession = null;
    await this.apiSession.clearStorageData({ storages: ['cookies'] });
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
        await this.clearSession();
        this.config.onSessionExpired?.();
        throw error;
      } finally { this.refreshOperation = undefined; }
    })();
    return this.refreshOperation;
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
    const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const request = net.request({ method: method.toUpperCase(), url, session: this.apiSession, useSessionCookies: true, headers });
      request.on('error', reject);
      request.on('response', (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('error', reject);
        incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
      });
      if (payload !== undefined) request.write(payload);
      request.end();
    });
    const parsed = parseResponse(response.text);
    if (response.status < 200 || response.status >= 300) {
      const error = parsed as ApiErrorPayload | undefined;
      throw new DesktopApiError(response.status, error?.error?.message ?? error?.message ?? 'API request failed.');
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
