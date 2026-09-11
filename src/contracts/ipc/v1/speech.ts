import { z } from 'zod';

export const SPEECH_AUDIO_MAX_BYTES = 25 * 1024 * 1024;
export const SPEECH_SYNTHESIS_MAX_BYTES = 2_500_000;
export const speechAudioSchema = z.instanceof(Uint8Array)
  .refine(value => value.byteLength > 0 && value.byteLength <= SPEECH_AUDIO_MAX_BYTES, 'Speech recording is empty or exceeds the supported size limit.')
  .refine(isPcmWav, 'Speech recording must be a PCM WAV payload.');
export const speechLanguageSchema = z.string().trim().min(2).max(32).optional();

export interface SpeechTranscriptionResult {
  text: string;
  language?: string;
}

export const speechSynthesisInputSchema = z.object({
  input: z.string().trim().min(1).max(4_096),
  voice: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(256).optional(),
  responseFormat: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional(),
}).strict();

export const speechSynthesisAgentResultSchema = z.object({
  contentType: z.string().trim().min(1).max(128),
  bytesBase64: z.string().min(1).max(Math.ceil(SPEECH_SYNTHESIS_MAX_BYTES / 3) * 4 + 4),
}).strict();

export type SpeechSynthesisInput = z.infer<typeof speechSynthesisInputSchema>;

export interface SpeechSynthesisResult {
  audio: Uint8Array;
  mimeType: string;
}

export interface DesktopSpeechApi {
  transcribe(audio: Uint8Array, language?: string): Promise<SpeechTranscriptionResult>;
  synthesize(cwd: string, input: SpeechSynthesisInput): Promise<SpeechSynthesisResult>;
}

function isPcmWav(value: Uint8Array): boolean {
  return value.byteLength >= 44 && ascii(value, 0, 'RIFF') && ascii(value, 8, 'WAVE') && ascii(value, 12, 'fmt ');
}

function ascii(value: Uint8Array, offset: number, expected: string): boolean {
  return [...expected].every((character, index) => value[offset + index] === character.charCodeAt(0));
}
