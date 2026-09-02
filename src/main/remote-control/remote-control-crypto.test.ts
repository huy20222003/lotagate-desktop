import { describe, expect, it } from 'vitest';
import { createRemoteCipher, createRemoteKeyPair } from './remote-control-crypto.js';

describe('Remote Control application encryption', () => {
  it('encrypts and decrypts only between the two ECDH peers', () => {
    const host = createRemoteKeyPair();
    const controller = createRemoteKeyPair();
    const hostCipher = createRemoteCipher(host, controller.publicKey, 'session-id');
    const controllerCipher = createRemoteCipher(controller, host.publicKey, 'session-id');
    const envelope = hostCipher.encrypt('event', { message: 'private' }, 'message-id', 0);
    expect(controllerCipher.decrypt(envelope)).toEqual({ type: 'event', payload: { message: 'private' } });
    expect(() => createRemoteCipher(createRemoteKeyPair(), controller.publicKey, 'session-id').decrypt(envelope)).toThrow();
  });
});
