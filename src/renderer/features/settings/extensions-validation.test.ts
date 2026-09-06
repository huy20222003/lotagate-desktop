import { describe, expect, it } from 'vitest';
import { validatePluginIntegrity } from './extensions-validation.js';

describe('plugin integrity validation', () => {
  it('accepts an optional checksum without signature metadata', () => {
    expect(validatePluginIntegrity('a'.repeat(64), '', '')).toEqual({});
  });

  it('requires signature metadata as a pair and validates checksum format', () => {
    expect(validatePluginIntegrity('invalid', 'signature', '')).toEqual({
      sha256: 'SHA-256 must contain exactly 64 hexadecimal characters.',
      signature: 'Signature and public key must be provided together.',
    });
  });
});
