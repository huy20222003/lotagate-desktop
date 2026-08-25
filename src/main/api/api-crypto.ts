import { randomUUID, webcrypto } from 'node:crypto';
import { API_CRYPTO } from './api-contract.js';

const subtle = webcrypto.subtle;
export type EcPublicJwk = JsonWebKey & { kty: 'EC'; crv: 'P-256'; x: string; y: string };

export interface EncryptedEnvelope {
  encrypted: true;
  v: number;
  kid: string;
  alg: string;
  iv: string;
  ciphertext: string;
  tag: string;
  ts: number;
  seq: number;
  rid: string;
}

export interface ApiCryptoSession {
  kid: string;
  expiresAt: number;
  requestKey: CryptoKey;
  responseKey: CryptoKey;
  requestSeq: number;
}

export interface ApiCryptoRequestContext {
  kid: string;
  ts: number;
  seq: number;
  rid: string;
  method: string;
  path: string;
}

interface BootstrapResponse {
  kid: string;
  salt: string;
  serverPublicKey: EcPublicJwk;
  expiresAt: number;
}

export async function bootstrapCryptoSession(
  request: (body: EcPublicJwk) => Promise<BootstrapResponse>,
): Promise<ApiCryptoSession> {
  const clientKeys = await subtle.generateKey({ name: 'ECDH', namedCurve: API_CRYPTO.curve }, true, ['deriveBits']);
  const publicKey = (await subtle.exportKey('jwk', clientKeys.publicKey)) as EcPublicJwk;
  const payload = await request(publicKey);
  const serverKey = await subtle.importKey('jwk', payload.serverPublicKey, { name: 'ECDH', namedCurve: API_CRYPTO.curve }, false, []);
  const sharedSecret = await subtle.deriveBits({ name: 'ECDH', public: serverKey }, clientKeys.privateKey, 256);
  const hkdfKey = await subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveBits']);
  const salt = fromBase64Url(payload.salt);
  const [requestRaw, responseRaw] = await Promise.all([
    subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: encode(API_CRYPTO.requestInfo) }, hkdfKey, 256),
    subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: encode(API_CRYPTO.responseInfo) }, hkdfKey, 256),
  ]);
  const [requestKey, responseKey] = await Promise.all([
    subtle.importKey('raw', requestRaw, { name: 'AES-GCM', length: 256 }, false, ['encrypt']),
    subtle.importKey('raw', responseRaw, { name: 'AES-GCM', length: 256 }, false, ['decrypt']),
  ]);
  return { kid: payload.kid, expiresAt: payload.expiresAt, requestKey, responseKey, requestSeq: 0 };
}

export function nextContext(session: ApiCryptoSession, method: string, path: string): ApiCryptoRequestContext {
  session.requestSeq += 1;
  return { kid: session.kid, ts: Date.now(), seq: session.requestSeq, rid: randomUUID(), method: method.toUpperCase(), path };
}

export async function encryptJson(data: unknown, session: ApiCryptoSession, context: ApiCryptoRequestContext): Promise<EncryptedEnvelope> {
  return encryptEnvelope(data, session.requestKey, context, 'request');
}

export async function encryptResponseJson(data: unknown, session: ApiCryptoSession, context: ApiCryptoRequestContext): Promise<EncryptedEnvelope> {
  return encryptEnvelope(data, session.responseKey, context, 'response');
}

async function encryptEnvelope(data: unknown, key: CryptoKey, context: ApiCryptoRequestContext, direction: 'request' | 'response'): Promise<EncryptedEnvelope> {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad({ ...context, direction }), tagLength: 128 }, key, encode(JSON.stringify(data))));
  const split = encrypted.length - 16;
  return {
    encrypted: true,
    v: API_CRYPTO.version,
    kid: context.kid,
    alg: API_CRYPTO.algorithm,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(encrypted.slice(0, split)),
    tag: toBase64Url(encrypted.slice(split)),
    ts: context.ts,
    seq: context.seq,
    rid: context.rid,
  };
}

export async function decryptJson<T>(envelope: EncryptedEnvelope, session: ApiCryptoSession, context: ApiCryptoRequestContext): Promise<T> {
  if (envelope.kid !== context.kid || envelope.rid !== context.rid || envelope.v !== API_CRYPTO.version || envelope.alg !== API_CRYPTO.algorithm) {
    throw new Error('Encrypted API response does not match the originating request.');
  }
  const ciphertext = fromBase64Url(envelope.ciphertext);
  const tag = fromBase64Url(envelope.tag);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(envelope.iv), additionalData: aad({ direction: 'response', method: context.method, path: context.path, kid: context.kid, ts: envelope.ts, seq: envelope.seq, rid: context.rid }), tagLength: 128 }, session.responseKey, combined);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

export function isEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<EncryptedEnvelope>;
  return candidate.encrypted === true && candidate.v === API_CRYPTO.version && candidate.alg === API_CRYPTO.algorithm && typeof candidate.kid === 'string' && typeof candidate.iv === 'string' && typeof candidate.ciphertext === 'string' && typeof candidate.tag === 'string' && typeof candidate.ts === 'number' && typeof candidate.seq === 'number' && typeof candidate.rid === 'string';
}

export function shouldRotate(session: ApiCryptoSession | null): boolean {
  return session === null || session.expiresAt <= Date.now() || session.requestSeq >= API_CRYPTO.rotateAfterRequests;
}

function aad(input: ApiCryptoRequestContext & { direction: 'request' | 'response' }) {
  return encode(JSON.stringify({ v: API_CRYPTO.version, d: input.direction, m: input.method.toUpperCase(), p: input.path, kid: input.kid, ts: input.ts, seq: input.seq, rid: input.rid }));
}

function encode(value: string): Uint8Array { return new TextEncoder().encode(value); }

function toBase64Url(value: ArrayLike<number>): string {
  return Buffer.from(Uint8Array.from(value)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(Buffer.from(padded, 'base64'));
}
