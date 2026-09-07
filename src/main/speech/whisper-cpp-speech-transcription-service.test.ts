import { describe, expect, it } from 'vitest';
import { normalizeWhisperLanguage, parseWhisperCppJson } from './whisper-cpp-speech-transcription-service.js';

describe('whisper.cpp speech transcription helpers', () => {
  it('normalizes browser locale values to whisper language codes', () => {
    expect(normalizeWhisperLanguage('vi-VN')).toBe('vi');
    expect(normalizeWhisperLanguage('en_US')).toBe('en');
    expect(normalizeWhisperLanguage('  ')).toBeUndefined();
  });

  it('combines and trims whisper.cpp transcription segments', () => {
    expect(parseWhisperCppJson('{"result":{"language":"vi"},"transcription":[{"text":" Xin chào "},{"text":"LotaGate"}]}')).toEqual({ text: 'Xin chào LotaGate', language: 'vi' });
  });

  it('accepts an empty transcription without fabricating text', () => {
    expect(parseWhisperCppJson('{"result":{"language":"vi"},"transcription":[]}')).toEqual({ text: '', language: 'vi' });
  });

  it('rejects malformed whisper.cpp output', () => {
    expect(() => parseWhisperCppJson('{"segments":[]}')).toThrow('invalid transcription result');
  });
});
