import { encodeRawPcm16Wav } from '../composer/audio-wav.js';
import type { SpeechSynthesisInput } from '../../../../contracts/ipc/v1/speech.js';

export const LIVE_CHAT_SILENCE_MS = 1_200;
export const LIVE_CHAT_SPEECH_THRESHOLD = 0.035;
export const LIVE_CHAT_STREAM_FLUSH_CHARACTERS = 280;
export const LIVE_CHAT_SPEECH_CHUNK_CHARACTERS = 3_500;
// Google Gemini TTS returns raw little-endian PCM16 mono audio at 24 kHz.
export const LIVE_CHAT_TTS_SAMPLE_RATE = 24_000;
export const AUDIO_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

export function toPlayableSpeechAudio(
  bytes: Uint8Array,
  providedMimeType: string,
  responseFormat: SpeechSynthesisInput['responseFormat'],
): { bytes: Uint8Array; mimeType: string } {
  if (responseFormat !== 'pcm' || (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE'))) {
    return { bytes, mimeType: providedMimeType };
  }

  return {
    bytes: encodeRawPcm16Wav(bytes, parsePcmSampleRate(providedMimeType) ?? LIVE_CHAT_TTS_SAMPLE_RATE),
    mimeType: 'audio/wav',
  };
}

export function createVoiceActivityMonitor(
  stream: MediaStream,
  onAudioLevel: (level: number) => void,
  onSilence: () => void,
): () => void {
  const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AudioContextConstructor === undefined) return () => undefined;

  let context: AudioContext | undefined;
  try { context = new AudioContextConstructor(); }
  catch { return () => undefined; }

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const data = new Float32Array(analyser.fftSize);
  let lastVoiceAt = 0;
  let heardVoice = false;
  let frame = 0;
  let stopped = false;

  const monitor = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const value = data[i] ?? 0;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / data.length);
    onAudioLevel(Math.min(1, rms * 4.5));

    const now = performance.now();
    if (rms >= LIVE_CHAT_SPEECH_THRESHOLD) {
      heardVoice = true;
      lastVoiceAt = now;
    } else if (heardVoice && now - lastVoiceAt >= LIVE_CHAT_SILENCE_MS) {
      stopped = true;
      onSilence();
      return;
    }
    frame = window.requestAnimationFrame(monitor);
  };

  void context.resume();
  monitor();

  return () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
    try {
      source.disconnect();
      analyser.disconnect();
      void context?.close();
    } catch {
      // Stream teardown cleanup.
    }
  };
}

export function splitSpeechText(text: string): string[] {
  const remaining = text.trim();
  if (remaining.length <= LIVE_CHAT_SPEECH_CHUNK_CHARACTERS) return remaining.length === 0 ? [] : [remaining];
  const chunks: string[] = [];
  let cursor = remaining;
  while (cursor.length > LIVE_CHAT_SPEECH_CHUNK_CHARACTERS) {
    const windowText = cursor.slice(0, LIVE_CHAT_SPEECH_CHUNK_CHARACTERS);
    const breakAt = Math.max(windowText.lastIndexOf('\n\n'), windowText.lastIndexOf('. '), windowText.lastIndexOf(' '));
    const cut = breakAt > Math.floor(LIVE_CHAT_SPEECH_CHUNK_CHARACTERS * 0.45)
      ? breakAt + (windowText[breakAt] === '.' ? 1 : 0)
      : LIVE_CHAT_SPEECH_CHUNK_CHARACTERS;
    chunks.push(cursor.slice(0, cut).trim());
    cursor = cursor.slice(cut).trimStart();
  }
  if (cursor.length > 0) chunks.push(cursor);
  return chunks;
}

export function speechReadySlice(text: string, completed: boolean): { text: string; consumedLength: number } {
  if (text.length === 0) return { text: '', consumedLength: 0 };
  if (completed) return { text: text.trim(), consumedLength: text.length };

  let boundary = 0;
  for (const match of text.matchAll(/[.!?。！？](?:["'”’)\]]*)\s+/gu)) boundary = (match.index ?? 0) + match[0].length;
  const paragraphBoundary = text.lastIndexOf('\n\n');
  if (paragraphBoundary >= 0) boundary = Math.max(boundary, paragraphBoundary + 2);
  if (boundary === 0 && text.length >= LIVE_CHAT_STREAM_FLUSH_CHARACTERS) {
    const whitespace = text.lastIndexOf(' ', LIVE_CHAT_STREAM_FLUSH_CHARACTERS);
    boundary = whitespace > Math.floor(LIVE_CHAT_STREAM_FLUSH_CHARACTERS * 0.55) ? whitespace + 1 : LIVE_CHAT_STREAM_FLUSH_CHARACTERS;
  }
  return boundary === 0 ? { text: '', consumedLength: 0 } : { text: text.slice(0, boundary).trim(), consumedLength: boundary };
}

export function playableAudioMimeType(bytes: Uint8Array, providedMimeType: string): string {
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return 'audio/wav';
  if (ascii(bytes, 0, 'OggS')) return 'audio/ogg';
  if (ascii(bytes, 0, 'fLaC')) return 'audio/flac';
  if (isAacFrame(bytes)) return 'audio/aac';
  if (ascii(bytes, 0, 'ID3') || isMpegFrame(bytes)) return 'audio/mpeg';
  const normalized = providedMimeType.split(';', 1)[0]?.trim().toLowerCase();
  if (normalized === 'audio/mp3' || normalized === 'audio/x-mp3' || normalized === 'audio/x-mpeg') return 'audio/mpeg';
  if (normalized === 'audio/x-wav' || normalized === 'audio/vnd.wave') return 'audio/wav';
  if (normalized === 'application/ogg') return 'audio/ogg';
  return normalized && normalized.startsWith('audio/') ? normalized : 'audio/mpeg';
}

export function isAudioDecodeFailure(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /decode audio data|media (?:source|format)|not supported/iu.test(message);
}

function isMpegFrame(bytes: Uint8Array): boolean { return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0; }
function isAacFrame(bytes: Uint8Array): boolean { return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0; }
function ascii(bytes: Uint8Array, offset: number, expected: string): boolean { return bytes.length >= offset + expected.length && [...expected].every((character, index) => bytes[offset + index] === character.charCodeAt(0)); }
function parsePcmSampleRate(mimeType: string): number | undefined {
  const match = /(?:^|;)\s*rate\s*=\s*(\d+)\s*(?:;|$)/iu.exec(mimeType);
  const sampleRate = Number(match?.[1]);
  return Number.isInteger(sampleRate) && sampleRate > 0 ? sampleRate : undefined;
}

export function microphoneErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/NotAllowedError|SecurityError|permission/iu.test(message)) return 'Microphone access was denied. Enable microphone access for desktop apps in Windows Privacy settings.';
  if (/NotFoundError|DevicesNotFoundError|no microphone/iu.test(message)) return 'No microphone is available. Connect a microphone and try again.';
  if (/NotReadableError|TrackStartError|busy/iu.test(message)) return 'The microphone is busy or unavailable to this app.';
  return message || 'Microphone recording failed. Check the Windows microphone settings and try again.';
}
