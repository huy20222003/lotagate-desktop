import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Mic, Square, X } from 'lucide-react';
import type { SpeechSynthesisInput } from '../../../../contracts/ipc/v1/speech.js';
import type { WorkspaceModelOption } from '../../../services/model-catalog.js';
import { IconButton } from '../../../components/ui.js';
import { useResizableSidePanel } from '../state/use-resizable-panel.js';
import { recordingToWav } from '../composer/audio-wav.js';
import type { AssistantFinalResponse } from './assistant-response.js';

const LIVE_CHAT_DEFAULT_VOICE = 'alloy';
const LIVE_CHAT_RESPONSE_FORMAT = 'mp3' as const;
const LIVE_CHAT_SILENCE_MS = 1_200;
const LIVE_CHAT_INITIAL_SILENCE_MS = 8_000;
const LIVE_CHAT_SPEECH_THRESHOLD = 0.035;
const LIVE_CHAT_SPEECH_CHUNK_CHARACTERS = 3_500;
const AUDIO_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

type LiveChatStatus = 'starting' | 'listening' | 'transcribing' | 'waiting' | 'speaking' | 'idle' | 'error';

interface ActiveAudioPlayback {
  audio: HTMLAudioElement;
  url: string;
  resolve: () => void;
}

export function LiveChatDrawer({
  cwd,
  models,
  thinking,
  error: agentError,
  assistantFinalResponse,
  onSend,
  onClose,
}: {
  cwd: string;
  models: readonly WorkspaceModelOption[];
  thinking: boolean;
  error: string | undefined;
  assistantFinalResponse: AssistantFinalResponse | undefined;
  onSend: (prompt: string) => Promise<void>;
  onClose: () => void;
}) {
  const { panelWidth, resizing, startResize, handleResizeKeyDown } = useResizableSidePanel();
  const recorderRef = useRef<MediaRecorder | undefined>();
  const recorderStreamRef = useRef<MediaStream | undefined>();
  const chunksRef = useRef<Blob[]>([]);
  const vadCleanupRef = useRef<(() => void) | undefined>();
  const activePlaybackRef = useRef<ActiveAudioPlayback | undefined>();
  const mountedRef = useRef(true);
  const speechGenerationRef = useRef(0);
  const initializedResponseRef = useRef(false);
  const spokenResponseKeyRef = useRef<string | undefined>();

  const [status, setStatus] = useState<LiveChatStatus>('starting');
  const statusRef = useRef<LiveChatStatus>('starting');
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | undefined>();

  const updateStatus = useCallback((nextStatus: LiveChatStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const disposePlayback = useCallback(() => {
    const active = activePlaybackRef.current;
    if (active === undefined) return;
    activePlaybackRef.current = undefined;
    active.audio.pause();
    active.audio.src = '';
    URL.revokeObjectURL(active.url);
    active.resolve();
  }, []);

  const stopSpeaking = useCallback(() => {
    speechGenerationRef.current += 1;
    disposePlayback();
    if (mountedRef.current) updateStatus('idle');
  }, [disposePlayback, updateStatus]);

  const stopListening = useCallback(() => {
    vadCleanupRef.current?.();
    vadCleanupRef.current = undefined;
    setAudioLevel(0);

    const stream = recorderStreamRef.current;
    recorderStreamRef.current = undefined;
    stream?.getTracks().forEach(track => track.stop());

    const recorder = recorderRef.current;
    recorderRef.current = undefined;

    if (recorder !== undefined && recorder.state === 'recording') {
      if (mountedRef.current) updateStatus('transcribing');
      try {
        recorder.stop();
      } catch {
        // Safe to ignore if already stopped.
      }
    }
  }, [updateStatus]);

  const transcribeRecording = useCallback(
    async (blob: Blob) => {
      if (!mountedRef.current) return;
      updateStatus('transcribing');
      try {
        const wav = await recordingToWav(blob);
        const result = await window.lotagate.speech.transcribe(wav);
        const text = result.text.trim();
        if (text.length === 0) {
          if (mountedRef.current) updateStatus('idle');
          return;
        }
        if (!mountedRef.current) return;
        await onSend(text);
        if (mountedRef.current) updateStatus('waiting');
      } catch (reason) {
        if (!mountedRef.current) return;
        setError(reason instanceof Error ? reason.message : 'Unable to transcribe the recording.');
        updateStatus('error');
      }
    },
    [onSend, updateStatus]
  );

  const startListening = useCallback(async () => {
    const currentStatus = statusRef.current;
    if (
      !mountedRef.current ||
      recorderRef.current !== undefined ||
      currentStatus === 'transcribing' ||
      currentStatus === 'waiting' ||
      currentStatus === 'speaking'
    ) {
      return;
    }

    stopSpeaking();
    setError(undefined);
    setAudioLevel(0);
    updateStatus('starting');

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Audio recording is not supported in this app environment.');
      updateStatus('error');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      recorderStreamRef.current = stream;
      chunksRef.current = [];

      const mimeType = AUDIO_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const chunks = [...chunksRef.current];
        chunksRef.current = [];
        const blob = new Blob(chunks, { type: recorder.mimeType });
        void transcribeRecording(blob);
      };

      recorderRef.current = recorder;

      vadCleanupRef.current = createVoiceActivityMonitor(
        stream,
        level => {
          if (mountedRef.current) setAudioLevel(level);
        },
        () => stopListening()
      );

      recorder.start(250);
      updateStatus('listening');
    } catch (reason) {
      stopListening();
      if (!mountedRef.current) return;
      setError(microphoneErrorMessage(reason));
      updateStatus('error');
    }
  }, [stopListening, stopSpeaking, transcribeRecording, updateStatus]);

  const playSpeechAudio = useCallback(
    (audio: Uint8Array, mimeType: string): Promise<void> => {
      disposePlayback();
      const bytes = new Uint8Array(audio.byteLength);
      bytes.set(audio);
      const blob = new Blob([bytes.buffer], { type: playableAudioMimeType(bytes, mimeType) });
      const url = URL.createObjectURL(blob);
      const audioElement = new Audio();
      audioElement.preload = 'auto';

      return new Promise<void>((resolve, reject) => {
        let settled = false;
        let started = false;
        const finish = (reason?: unknown) => {
          if (settled) return;
          settled = true;
          if (activePlaybackRef.current?.audio === audioElement) {
            activePlaybackRef.current = undefined;
          }
          audioElement.pause();
          audioElement.src = '';
          URL.revokeObjectURL(url);
          if (reason instanceof Error) reject(reason);
          else resolve();
        };
        const start = () => {
          if (started || settled) return;
          started = true;
          void audioElement.play().catch(finish);
        };

        activePlaybackRef.current = { audio: audioElement, url, resolve: () => finish() };
        audioElement.onended = () => finish();
        audioElement.onerror = () => finish(new Error('Unable to decode audio data.'));
        audioElement.onloadeddata = start;
        audioElement.oncanplay = start;
        audioElement.src = url;
        audioElement.load();
      });
    },
    [disposePlayback]
  );

  const speakResponse = useCallback(
    async (response: string) => {
      const generation = ++speechGenerationRef.current;
      stopListening();
      setError(undefined);
      updateStatus('speaking');

      try {
        for (const input of splitSpeechText(response)) {
          if (!mountedRef.current || speechGenerationRef.current !== generation) return;
          const model = models.find(candidate => candidate.category === 'speech')?.id;
          const request: SpeechSynthesisInput = {
            input,
            voice: LIVE_CHAT_DEFAULT_VOICE,
            responseFormat: LIVE_CHAT_RESPONSE_FORMAT,
            ...(model === undefined ? {} : { model }),
          };
          const audio = await window.lotagate.speech.synthesize(cwd, request);
          if (!mountedRef.current || speechGenerationRef.current !== generation) return;
          await playSpeechAudio(audio.audio, audio.mimeType);
        }

        if (mountedRef.current && speechGenerationRef.current === generation) {
          updateStatus('idle');
          void startListening();
        }
      } catch (reason) {
        if (!mountedRef.current || speechGenerationRef.current !== generation) return;
        setError(reason instanceof Error ? reason.message : 'Unable to play the agent response.');
        updateStatus('error');
      }
    },
    [cwd, models, playSpeechAudio, startListening, stopListening, updateStatus]
  );

  useEffect(() => {
    if (!initializedResponseRef.current) {
      initializedResponseRef.current = true;
      if (assistantFinalResponse !== undefined) spokenResponseKeyRef.current = assistantFinalResponse.turnId;
      return;
    }
    if (assistantFinalResponse === undefined || spokenResponseKeyRef.current === assistantFinalResponse.turnId) return;
    spokenResponseKeyRef.current = assistantFinalResponse.turnId;
    void speakResponse(assistantFinalResponse.text);
  }, [assistantFinalResponse, speakResponse]);

  useEffect(() => {
    if (status !== 'waiting' || thinking || agentError === undefined) return;
    setError(agentError);
    updateStatus('error');
  }, [agentError, status, thinking, updateStatus]);

  useEffect(() => {
    mountedRef.current = true;
    void startListening();
    return () => {
      mountedRef.current = false;
      speechGenerationRef.current += 1;
      disposePlayback();
      stopListening();
    };
  }, [disposePlayback, startListening, stopListening]);

  const recording = status === 'starting' || status === 'listening';
  const statusLabel =
    status === 'starting'
      ? 'Starting microphone…'
      : status === 'listening'
        ? 'Listening… pause to send'
        : status === 'transcribing'
          ? 'Converting speech to text…'
          : status === 'waiting'
            ? 'Waiting for the agent…'
            : status === 'speaking'
              ? 'Agent is speaking…'
              : status === 'error'
                ? 'Live chat needs attention'
                : 'Tap microphone to speak';

  return (
    <aside
      className={`file-changes-panel live-chat-panel${resizing ? ' is-resizing' : ''}`}
      style={{ width: `${panelWidth}px` }}
      aria-label="Live chat"
    >
      <div
        className="file-changes-resize-handle"
        role="separator"
        aria-label="Resize live chat panel"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={handleResizeKeyDown}
      />

      <header className="file-changes-panel-header live-chat-panel-header">
        <div className="live-chat-title">
          <AudioLines size={16} />
          <strong>Live chat</strong>
        </div>
        <IconButton icon={X} iconSize={16} label="Close live chat" onClick={onClose} />
      </header>

      <div className={`live-chat-stage is-${status}`}>
        <div className="live-orb-container">
          <div
            className="live-orb-ambient-glow"
            style={
              status === 'listening' && audioLevel > 0
                ? {
                    transform: `scale(${1 + audioLevel * 0.3})`,
                    opacity: Math.min(1, 0.75 + audioLevel * 0.25),
                  }
                : undefined
            }
          />
          <div
            className="live-orb-sphere"
            style={
              status === 'listening' && audioLevel > 0
                ? {
                    transform: `scale(${1 + audioLevel * 0.08})`,
                  }
                : undefined
            }
          >
            <div className="live-orb-layer live-orb-layer-base" />
            <div className="live-orb-layer live-orb-layer-white" />
            <div className="live-orb-layer live-orb-layer-cloud" />
            <div className="live-orb-layer live-orb-layer-swirl" />
            <div className="live-orb-rim" />
          </div>
        </div>

        <div className={`live-chat-status-container live-chat-status-${status}`}>
          <div className="live-chat-status">
            <span className="live-chat-status-dot" />
            <span>{statusLabel}</span>
          </div>
          {error ? <div className="live-chat-error-message">{error}</div> : null}
        </div>
      </div>

      <footer className="live-chat-footer">
        <div className={`live-chat-mic-wrapper${recording ? ' is-recording' : ''}`}>
          <div className="live-chat-mic-pulse" />
          {status === 'speaking' ? (
            <button
              type="button"
              className="live-chat-mic-btn is-stop"
              aria-label="Stop agent speech"
              onClick={stopSpeaking}
            >
              <Square size={20} />
            </button>
          ) : recording ? (
            <button
              type="button"
              className="live-chat-mic-btn is-active"
              aria-label="Stop listening and send"
              onClick={stopListening}
            >
              <Square size={20} />
            </button>
          ) : (
            <button
              type="button"
              className="live-chat-mic-btn"
              aria-label="Start live chat recording"
              disabled={status === 'transcribing' || status === 'waiting' || thinking}
              onClick={() => void startListening()}
            >
              <Mic size={22} />
            </button>
          )}
        </div>
      </footer>
    </aside>
  );
}

function createVoiceActivityMonitor(
  stream: MediaStream,
  onAudioLevel: (level: number) => void,
  onSilence: () => void
): () => void {
  const AudioContextConstructor =
    window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AudioContextConstructor === undefined) return () => undefined;

  let context: AudioContext | undefined;
  try {
    context = new AudioContextConstructor();
  } catch {
    return () => undefined;
  }

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const data = new Float32Array(analyser.fftSize);
  const startedAt = performance.now();
  let lastVoiceAt = startedAt;
  let heardVoice = false;
  let frame = 0;
  let stopped = false;

  const monitor = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const val = data[i] ?? 0;
      sum += val * val;
    }
    const rms = Math.sqrt(sum / data.length);
    onAudioLevel(Math.min(1, rms * 4.5));

    const now = performance.now();
    if (rms >= LIVE_CHAT_SPEECH_THRESHOLD) {
      heardVoice = true;
      lastVoiceAt = now;
    } else if (
      (heardVoice && now - lastVoiceAt >= LIVE_CHAT_SILENCE_MS) ||
      (!heardVoice && now - startedAt >= LIVE_CHAT_INITIAL_SILENCE_MS)
    ) {
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
      // Stream teardown cleanup
    }
  };
}

function splitSpeechText(text: string): string[] {
  const remaining = text.trim();
  if (remaining.length <= LIVE_CHAT_SPEECH_CHUNK_CHARACTERS) return remaining.length === 0 ? [] : [remaining];
  const chunks: string[] = [];
  let cursor = remaining;
  while (cursor.length > LIVE_CHAT_SPEECH_CHUNK_CHARACTERS) {
    const windowText = cursor.slice(0, LIVE_CHAT_SPEECH_CHUNK_CHARACTERS);
    const breakAt = Math.max(windowText.lastIndexOf('\n\n'), windowText.lastIndexOf('. '), windowText.lastIndexOf(' '));
    const cut =
      breakAt > Math.floor(LIVE_CHAT_SPEECH_CHUNK_CHARACTERS * 0.45)
        ? breakAt + (windowText[breakAt] === '.' ? 1 : 0)
        : LIVE_CHAT_SPEECH_CHUNK_CHARACTERS;
    chunks.push(cursor.slice(0, cut).trim());
    cursor = cursor.slice(cut).trimStart();
  }
  if (cursor.length > 0) chunks.push(cursor);
  return chunks;
}

function playableAudioMimeType(bytes: Uint8Array, providedMimeType: string): string {
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return 'audio/wav';
  if (ascii(bytes, 0, 'OggS')) return 'audio/ogg';
  if (ascii(bytes, 0, 'fLaC')) return 'audio/flac';
  if (ascii(bytes, 0, 'ID3') || isMpegFrame(bytes)) return 'audio/mpeg';
  if (isAacFrame(bytes)) return 'audio/aac';
  const normalized = providedMimeType.split(';', 1)[0]?.trim().toLowerCase();
  return normalized && normalized.startsWith('audio/') ? normalized : 'audio/mpeg';
}

function isMpegFrame(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}

function isAacFrame(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0;
}

function ascii(bytes: Uint8Array, offset: number, expected: string): boolean {
  return bytes.length >= offset + expected.length && [...expected].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function microphoneErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/NotAllowedError|SecurityError|permission/iu.test(message)) {
    return 'Microphone access was denied. Enable microphone access for desktop apps in Windows Privacy settings.';
  }
  if (/NotFoundError|DevicesNotFoundError|no microphone/iu.test(message)) {
    return 'No microphone is available. Connect a microphone and try again.';
  }
  if (/NotReadableError|TrackStartError|busy/iu.test(message)) {
    return 'The microphone is busy or unavailable to this app.';
  }
  return message || 'Microphone recording failed. Check the Windows microphone settings and try again.';
}
