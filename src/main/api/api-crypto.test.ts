import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { decryptJson, encryptResponseJson, isEnvelope, nextContext, shouldRotate, type ApiCryptoSession } from './api-crypto.js';

function session(overrides: Partial<ApiCryptoSession> = {}): ApiCryptoSession {
  return {
    kid: 'test-key',
    expiresAt: Date.now() + 60_000,
    requestKey: {} as CryptoKey,
    responseKey: {} as CryptoKey,
    requestSeq: 0,
    ...overrides,
  };
}

describe('desktop API crypto boundary', () => {
  it('creates monotonic request contexts with normalized methods', () => {
    const current = session();
    const first = nextContext(current, 'post', '/auth/login');
    const second = nextContext(current, 'GET', '/auth/me');

    expect(first.method).toBe('POST');
    expect(second.method).toBe('GET');
    expect(second.seq).toBe(first.seq + 1);
    expect(second.rid).not.toBe(first.rid);
  });

  it('rotates when the request limit or expiry is reached', () => {
    expect(shouldRotate(session({ requestSeq: 99 }))).toBe(false);
    expect(shouldRotate(session({ requestSeq: 100 }))).toBe(true);
    expect(shouldRotate(session({ expiresAt: Date.now() - 1 }))).toBe(true);
    expect(shouldRotate(null)).toBe(true);
  });

  it('recognizes only the desktop crypto envelope marker', () => {
    const envelope = { encrypted: true, v: 1, alg: 'A256GCM', kid: 'key', iv: 'iv', ciphertext: 'ciphertext', tag: 'tag', ts: Date.now(), seq: 1, rid: 'request' };
    expect(isEnvelope(envelope)).toBe(true);
    expect(isEnvelope({ ...envelope, encrypted: false })).toBe(false);
    expect(isEnvelope({ ...envelope, v: 2 })).toBe(false);
  });

  it('rejects a response envelope whose request id was tampered', async () => {
    const current = session();
    const context = nextContext(current, 'GET', '/auth/me');
    await expect(decryptJson({ encrypted: true, v: 1, kid: context.kid, alg: 'A256GCM', iv: '', ciphertext: '', tag: '', ts: context.ts, seq: context.seq + 1, rid: 'tampered' }, current, context)).rejects.toThrow('does not match');
  });

  it('round-trips a response with authenticated protocol metadata', async () => {
    const responseKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const current = session({ responseKey: responseKey as CryptoKey });
    const context = nextContext(current, 'GET', '/auth/me');
    const responseContext = { ...context, ts: context.ts + 1_000, seq: context.seq + 7 };
    const envelope = await encryptResponseJson({ user: { id: 'user-1' } }, current, responseContext);
    expect(envelope.ts).not.toBe(context.ts);
    expect(envelope.seq).not.toBe(context.seq);
    await expect(decryptJson(envelope, current, context)).resolves.toEqual({ user: { id: 'user-1' } });
    await expect(decryptJson({ ...envelope, tag: `${envelope.tag}tampered` }, current, context)).rejects.toBeTruthy();
  });
});
