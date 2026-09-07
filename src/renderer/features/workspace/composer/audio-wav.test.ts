import { describe, expect, it } from 'vitest';
import { encodePcm16Wav } from './audio-wav.js';

describe('WAV encoder', () => {
  it('creates a mono PCM16 RIFF payload for whisper.cpp', () => {
    const wav = encodePcm16Wav(new Float32Array([0, 0.5, -1]), 16_000);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE');
    expect(wav.byteLength).toBe(50);
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16_000);
  });
});
