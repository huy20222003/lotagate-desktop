import { z } from 'zod';

export const SPEECH_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const speechAudioSchema = z.instanceof(Uint8Array)
  .refine(value => value.byteLength > 0 && value.byteLength <= SPEECH_AUDIO_MAX_BYTES, 'Speech recording is empty or exceeds the supported size limit.')
  .refine(isPcmWav, 'Speech recording must be a PCM WAV payload.');
export const speechLanguageSchema = z.string().trim().min(2).max(32).optional();

export interface SpeechTranscriptionResult {
  text: string;
  language?: string;
}

export interface DesktopSpeechApi {
  transcribe(audio: Uint8Array, language?: string): Promise<SpeechTranscriptionResult>;
}

function isPcmWav(value: Uint8Array): boolean {
  return value.byteLength >= 44 && ascii(value, 0, 'RIFF') && ascii(value, 8, 'WAVE') && ascii(value, 12, 'fmt ');
}

function ascii(value: Uint8Array, offset: number, expected: string): boolean {
  return [...expected].every((character, index) => value[offset + index] === character.charCodeAt(0));
}
