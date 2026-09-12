import { describe, expect, it } from 'vitest';
import { encodePcm16Wav, encodeRawPcm16Wav } from './audio-wav.js';

describe('WAV encoder', () => {
  it('creates a mono PCM16 RIFF payload for whisper.cpp', () => {
    const wav = encodePcm16Wav(new Float32Array([0, 0.5, -1]), 16_000);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE');
    expect(wav.byteLength).toBe(50);
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16_000);
  });

  it('wraps raw PCM16 bytes in a playable WAV container', () => {
    const wav = encodeRawPcm16Wav(new Uint8Array([0, 0, 0xff, 0x7f, 0x01]), 24_000);
    const view = new DataView(wav.buffer);

    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE');
    expect(wav.byteLength).toBe(48);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4);
    expect([...wav.slice(44)]).toEqual([0, 0, 0xff, 0x7f]);
  });
});
