import { createCipheriv, createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

export interface EncryptedRemoteEnvelope { version: 1; type: 'encrypted'; messageId: string; sequence: number; sentAt: string; nonce: string; ciphertext: string }

export interface RemoteKeyPair { privateKey: Buffer; publicKey: string }
export interface RemoteCipher { encrypt(type: string, payload: unknown, messageId: string, sequence: number): EncryptedRemoteEnvelope; decrypt(envelope: EncryptedRemoteEnvelope): { type: string; payload: unknown } }

export function createRemoteKeyPair(): RemoteKeyPair {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { privateKey: ecdh.getPrivateKey(), publicKey: ecdh.getPublicKey().toString('base64url') };
}

export function createRemoteCipher(keyPair: RemoteKeyPair, peerPublicKey: string, sessionId: string): RemoteCipher {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(keyPair.privateKey);
  const secret = ecdh.computeSecret(Buffer.from(peerPublicKey, 'base64url'));
  const key = Buffer.from(hkdfSync('sha256', secret, Buffer.from(sessionId, 'utf8'), Buffer.from('lotagate-remote-control-v1', 'utf8'), 32));
  return {
    encrypt(type, payload, messageId, sequence) {
      const nonce = randomBytes(12);
      const aad = Buffer.from(`${messageId}:${sequence}`, 'utf8');
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ type, payload }), 'utf8'), cipher.final(), cipher.getAuthTag()]);
      return { version: 1, type: 'encrypted', messageId, sequence, sentAt: new Date().toISOString(), nonce: nonce.toString('base64url'), ciphertext: ciphertext.toString('base64url') };
    },
    decrypt(envelope) {
      const nonce = Buffer.from(envelope.nonce, 'base64url');
      const ciphertext = Buffer.from(envelope.ciphertext, 'base64url');
      if (nonce.length !== 12 || ciphertext.length < 16) throw new Error('Invalid remote encrypted payload.');
      const aad = Buffer.from(`${envelope.messageId}:${envelope.sequence}`, 'utf8');
      const decipher = createDecipheriv('aes-256-gcm', key, nonce);
      decipher.setAAD(aad); decipher.setAuthTag(ciphertext.subarray(-16));
      const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString('utf8');
      const value = JSON.parse(plaintext) as unknown;
      if (!isRecord(value) || typeof value['type'] !== 'string') throw new Error('Invalid remote decrypted payload.');
      return { type: value['type'], payload: value['payload'] };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
