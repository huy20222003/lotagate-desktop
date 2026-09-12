import { describe, expect, it } from 'vitest';
import { LIVE_CHAT_TTS_SAMPLE_RATE, toPlayableSpeechAudio } from './live-chat-audio.js';

describe('live chat speech audio', () => {
  it('wraps Google raw PCM using the declared sample rate', () => {
    const result = toPlayableSpeechAudio(new Uint8Array([0, 0, 1, 0]), 'audio/pcm;rate=16000', 'pcm');
    const view = new DataView(result.bytes.buffer);

    expect(result.mimeType).toBe('audio/wav');
    expect(new TextDecoder().decode(result.bytes.slice(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(16_000);
  });

  it('uses the Google TTS default rate when the response omits it', () => {
    const result = toPlayableSpeechAudio(new Uint8Array([0, 0]), 'application/octet-stream', 'pcm');

    expect(new DataView(result.bytes.buffer).getUint32(24, true)).toBe(LIVE_CHAT_TTS_SAMPLE_RATE);
  });

  it('does not wrap an already-containerized response', () => {
    const wav = new Uint8Array(44);
    wav.set([0x52, 0x49, 0x46, 0x46], 0);
    wav.set([0x57, 0x41, 0x56, 0x45], 8);

    const result = toPlayableSpeechAudio(wav, 'audio/pcm', 'pcm');

    expect(result.bytes).toBe(wav);
    expect(result.mimeType).toBe('audio/pcm');
  });
});
