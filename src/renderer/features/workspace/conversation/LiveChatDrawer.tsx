import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, X } from 'lucide-react';
import type { SpeechSynthesisInput } from '../../../../contracts/ipc/v1/speech.js';
import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import type { WorkspaceModelOption } from '../../../services/model-catalog.js';
import { IconButton } from '../../../components/ui.js';
import { useResizableSidePanel } from '../state/use-resizable-panel.js';
import { recordingToWav } from '../composer/audio-wav.js';
import type { AssistantFinalResponse } from './assistant-response.js';
import { DESKTOP_RUNTIME_LIMITS } from '../../../../contracts/runtime-limits.js';
import { AUDIO_MIME_TYPES, createVoiceActivityMonitor, isAudioDecodeFailure, microphoneErrorMessage, playableAudioMimeType, speechReadySlice, splitSpeechText, toPlayableSpeechAudio } from './live-chat-audio.js';

const LIVE_CHAT_DEFAULT_VOICE = 'alloy';
const LIVE_CHAT_RESPONSE_FORMAT = 'pcm' as const;

type LiveChatStatus = 'starting' | 'listening' | 'transcribing' | 'waiting' | 'speaking' | 'idle' | 'error';

interface ActiveAudioPlayback {
  audio: HTMLAudioElement;
  url: string;
  resolve: () => void;
}

interface SpeechCursor {
  cursor: number;
  completed: boolean;
}

export function LiveChatDrawer({
  cwd,
  models,
  thinking,
  error: agentError,
  assistantActivities,
  activeTurnId,
  assistantFinalResponse,
  onSend,
  onClose,
}: {
  cwd: string;
  models: readonly WorkspaceModelOption[];
  thinking: boolean;
  error: string | undefined;
  assistantActivities: readonly Activity[];
  activeTurnId: string | undefined;
  assistantFinalResponse: AssistantFinalResponse | undefined;
  onSend: (prompt: string) => Promise<void>;
  onClose: () => void;
}) {
  const { panelWidth, resizing, startResize, handleResizeKeyDown } = useResizableSidePanel();
  const onSendRef = useRef(onSend);
  const recorderRef = useRef<MediaRecorder | undefined>();
  const recorderStreamRef = useRef<MediaStream | undefined>();
  const chunksRef = useRef<Blob[]>([]);
  const recordingBytesRef = useRef(0);
  const recordingTimerRef = useRef<number | undefined>();
  const discardRecordingRef = useRef(false);
  const vadCleanupRef = useRef<(() => void) | undefined>();
  const activePlaybackRef = useRef<ActiveAudioPlayback | undefined>();
  const mountedRef = useRef(true);
  const speechGenerationRef = useRef(0);
  const streamInitializedRef = useRef(false);
  const streamTurnRef = useRef<string | undefined>();
  const streamCursorsRef = useRef(new Map<string, SpeechCursor>());
  const speechQueueRef = useRef<string[]>([]);
  const speechQueueCharactersRef = useRef(0);
  const speechRunnerRef = useRef(false);
  const speechStreamCompleteRef = useRef(false);
  const fallbackResponseTurnRef = useRef<string | undefined>();
  const finalizedSpeechTurnRef = useRef<string | undefined>();
  const startListeningRef = useRef<(() => Promise<void>) | undefined>();
  const restartTimerRef = useRef<number | undefined>();

  const [status, setStatus] = useState<LiveChatStatus>('starting');
  const statusRef = useRef<LiveChatStatus>('starting');
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

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

  const clearSpeechQueue = useCallback(() => {
    speechQueueRef.current = [];
    speechQueueCharactersRef.current = 0;
  }, []);

  const stopSpeaking = useCallback(() => {
    speechGenerationRef.current += 1;
    clearSpeechQueue();
    speechStreamCompleteRef.current = false;
    disposePlayback();
    if (mountedRef.current) updateStatus('idle');
  }, [clearSpeechQueue, disposePlayback, updateStatus]);

  const stopListening = useCallback(() => {
    if (recordingTimerRef.current !== undefined) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = undefined;
    }
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

  const scheduleListeningRestart = useCallback((delayMs = 0) => {
    if (!mountedRef.current) return;
    if (restartTimerRef.current !== undefined) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = undefined;
      if (mountedRef.current) void startListeningRef.current?.();
    }, delayMs);
  }, []);

  const transcribeRecording = useCallback(
    async (blob: Blob) => {
      if (!mountedRef.current) return;
      updateStatus('transcribing');
      try {
        if (blob.size === 0) {
          updateStatus('idle');
          scheduleListeningRestart();
          return;
        }
        const wav = await recordingToWav(blob);
        const result = await window.lotagate.speech.transcribe(wav);
        const text = result.text.trim();
        if (text.length === 0) {
          if (mountedRef.current) {
            updateStatus('idle');
            scheduleListeningRestart();
          }
          return;
        }
        if (!mountedRef.current) return;
        await onSendRef.current(text);
        if (mountedRef.current) updateStatus('waiting');
      } catch (reason) {
        if (!mountedRef.current) return;
        setError(reason instanceof Error ? reason.message : 'Unable to transcribe the recording.');
        updateStatus('error');
        scheduleListeningRestart(1_500);
      }
    },
    [scheduleListeningRestart, updateStatus]
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
      recordingBytesRef.current = 0;
      discardRecordingRef.current = false;

      const mimeType = AUDIO_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recorder.ondataavailable = event => {
        // Keep the first chunk: WebM/Ogg container headers are emitted before VAD hears speech.
        if (event.data.size <= 0) return;
        const nextBytes = recordingBytesRef.current + event.data.size;
        if (nextBytes > DESKTOP_RUNTIME_LIMITS.liveChatRecordingMaxBytes) {
          discardRecordingRef.current = true;
          setError('The recording is too large. Speak for a shorter time and try again.');
          stopListening();
          return;
        }
        chunksRef.current.push(event.data);
        recordingBytesRef.current = nextBytes;
      };

      recorder.onstop = () => {
        const chunks = [...chunksRef.current];
        chunksRef.current = [];
        recordingBytesRef.current = 0;
        const discarded = discardRecordingRef.current;
        discardRecordingRef.current = false;
        if (discarded) {
          if (mountedRef.current) { updateStatus('idle'); scheduleListeningRestart(); }
          return;
        }
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
      recordingTimerRef.current = window.setTimeout(() => {
        if (recorderRef.current === recorder) stopListening();
      }, DESKTOP_RUNTIME_LIMITS.liveChatRecordingMaxDurationMs);
      updateStatus('listening');
    } catch (reason) {
      stopListening();
      if (!mountedRef.current) return;
      setError(microphoneErrorMessage(reason));
      updateStatus('error');
    }
  }, [stopListening, stopSpeaking, transcribeRecording, updateStatus]);

  useEffect(() => {
    startListeningRef.current = startListening;
    return () => {
      if (startListeningRef.current === startListening) startListeningRef.current = undefined;
    };
  }, [startListening]);

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

  const runSpeechQueue = useCallback(async () => {
    if (!mountedRef.current || speechRunnerRef.current) return;
    speechRunnerRef.current = true;
    const generation = speechGenerationRef.current;

    try {
      while (mountedRef.current && speechGenerationRef.current === generation) {
        const next = speechQueueRef.current.shift();
        if (next === undefined) {
          if (speechStreamCompleteRef.current) {
            updateStatus('idle');
            void startListening();
          } else {
            updateStatus('waiting');
          }
          return;
        }
        speechQueueCharactersRef.current = Math.max(0, speechQueueCharactersRef.current - next.length);

        const inputs = splitSpeechText(next);
        if (inputs.length === 0) continue;
        updateStatus('speaking');
        for (const input of inputs) {
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
          const playableAudio = toPlayableSpeechAudio(audio.audio, audio.mimeType, request.responseFormat);
          try {
            await playSpeechAudio(playableAudio.bytes, playableAudio.mimeType);
          } catch (reason) {
            if (!isAudioDecodeFailure(reason) || request.responseFormat === 'pcm') throw reason;
            const fallback = await window.lotagate.speech.synthesize(cwd, {
              ...request,
              responseFormat: 'wav',
            });
            if (!mountedRef.current || speechGenerationRef.current !== generation) return;
            await playSpeechAudio(fallback.audio, fallback.mimeType);
          }
        }
      }
    } catch (reason) {
      if (!mountedRef.current || speechGenerationRef.current !== generation) return;
      setError(reason instanceof Error ? reason.message : 'Unable to play the agent response.');
      updateStatus('error');
      scheduleListeningRestart(1_500);
    } finally {
      speechRunnerRef.current = false;
      if (mountedRef.current && speechQueueRef.current.length > 0) void runSpeechQueue();
    }
  }, [cwd, models, playSpeechAudio, scheduleListeningRestart, startListening, updateStatus]);

  const enqueueSpeech = useCallback(
    (text: string) => {
      const normalized = text.trim();
      if (normalized.length === 0) return;
      const bounded = normalized.slice(0, DESKTOP_RUNTIME_LIMITS.liveChatSpeechQueueCharacters);
      while (speechQueueRef.current.length >= DESKTOP_RUNTIME_LIMITS.liveChatSpeechQueueEntries || speechQueueCharactersRef.current + bounded.length > DESKTOP_RUNTIME_LIMITS.liveChatSpeechQueueCharacters) {
        const removed = speechQueueRef.current.shift();
        if (removed === undefined) break;
        speechQueueCharactersRef.current = Math.max(0, speechQueueCharactersRef.current - removed.length);
      }
      speechQueueRef.current.push(bounded);
      speechQueueCharactersRef.current += bounded.length;
      void runSpeechQueue();
    },
    [runSpeechQueue]
  );

  useEffect(() => {
    const responseTurnId = activeTurnId ?? assistantFinalResponse?.turnId;
    if (responseTurnId === undefined) {
      streamInitializedRef.current = true;
      return;
    }

    const segments = assistantActivities
      .filter(activity => activity.kind === 'assistant' && activity.metadata['turnId'] === responseTurnId && activity.text.length > 0)
      .map(activity => ({
        key: `${responseTurnId}:${readStreamSegmentId(activity)}`,
        text: activity.text,
        completed:
          activity.metadata['assistantPhase'] === 'progress' ||
          activity.metadata['assistantPhase'] === 'final' ||
          assistantFinalResponse?.turnId === responseTurnId,
      }));

    if (streamTurnRef.current !== responseTurnId) {
      const skipExistingResponse = !streamInitializedRef.current;
      streamInitializedRef.current = true;
      streamTurnRef.current = responseTurnId;
      streamCursorsRef.current.clear();
      fallbackResponseTurnRef.current = undefined;
      finalizedSpeechTurnRef.current = undefined;
      speechStreamCompleteRef.current = false;

      if (!skipExistingResponse) {
        speechGenerationRef.current += 1;
        clearSpeechQueue();
        disposePlayback();
      } else {
        for (const segment of segments) streamCursorsRef.current.set(segment.key, { cursor: segment.text.length, completed: segment.completed });
        if (assistantFinalResponse?.turnId === responseTurnId) speechStreamCompleteRef.current = true;
        return;
      }
    }

    if (segments.length === 0) {
      if (assistantFinalResponse?.turnId === responseTurnId && fallbackResponseTurnRef.current !== responseTurnId) {
        fallbackResponseTurnRef.current = responseTurnId;
        speechStreamCompleteRef.current = true;
        finalizedSpeechTurnRef.current = responseTurnId;
        enqueueSpeech(assistantFinalResponse.text);
      }
      return;
    }

    for (const segment of segments) {
      const cursor = streamCursorsRef.current.get(segment.key) ?? { cursor: 0, completed: false };
      if (cursor.cursor > segment.text.length) cursor.cursor = segment.text.length;
      const ready = speechReadySlice(segment.text.slice(cursor.cursor), segment.completed);
      if (ready.text.length > 0) enqueueSpeech(ready.text);
      cursor.cursor += ready.consumedLength;
      cursor.completed = cursor.completed || segment.completed;
      streamCursorsRef.current.set(segment.key, cursor);
      if (!segment.completed) break;
    }

    if (assistantFinalResponse?.turnId === responseTurnId && finalizedSpeechTurnRef.current !== responseTurnId) {
      speechStreamCompleteRef.current = true;
      finalizedSpeechTurnRef.current = responseTurnId;
      void runSpeechQueue();
    }
  }, [activeTurnId, assistantActivities, assistantFinalResponse, clearSpeechQueue, disposePlayback, enqueueSpeech, runSpeechQueue]);

  useEffect(() => {
    if (status !== 'waiting' || thinking || agentError === undefined) return;
    setError(agentError);
    updateStatus('error');
    scheduleListeningRestart(1_500);
  }, [agentError, scheduleListeningRestart, status, thinking, updateStatus]);

  useEffect(() => {
    mountedRef.current = true;
    void startListening();
    return () => {
      if (restartTimerRef.current !== undefined) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = undefined;
      }
      mountedRef.current = false;
      speechGenerationRef.current += 1;
      disposePlayback();
      stopListening();
    };
  }, [disposePlayback, startListening, stopListening]);

  const statusLabel =
    status === 'starting'
      ? 'Starting microphone…'
      : status === 'listening'
        ? 'Listening… waiting for speech'
        : status === 'transcribing'
          ? 'Converting speech to text…'
          : status === 'waiting'
            ? 'Waiting for the agent…'
            : status === 'speaking'
              ? 'Agent is speaking…'
              : status === 'error'
                ? 'Live chat needs attention'
                : 'Waiting for speech…';

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

    </aside>
  );
}

function readStreamSegmentId(activity: Activity): string {
  const segmentId = activity.metadata['segmentId'];
  return typeof segmentId === 'string' && segmentId.length > 0 ? segmentId : activity.id;
}
