import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, Mic, Square } from 'lucide-react';
import { IconButton } from '../../../components/ui.js';
import { recordingToWav } from './audio-wav.js';

const AUDIO_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

export function VoiceInput({ disabled, onComplete, onError }: { disabled: boolean; onComplete: (transcript: string) => void; onError: (message: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => createSilentLevels());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | undefined>();
  const chunksRef = useRef<Blob[]>([]);
  const recordingRef = useRef(false);
  const audioCleanupRef = useRef<(() => void) | undefined>();

  const stopAudio = useCallback(() => {
    audioCleanupRef.current?.();
    audioCleanupRef.current = undefined;
    setLevels(createSilentLevels());
  }, []);
  const startAudio = useCallback((stream: MediaStream): void => {
    audioCleanupRef.current = () => stopStream(stream);
    const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextConstructor === undefined) return;
    const context = new AudioContextConstructor();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const update = () => {
      analyser.getByteFrequencyData(data);
      const average = data.reduce((total, value) => total + value, 0) / Math.max(1, data.length) / 255;
      setLevels(Array.from({ length: 48 }, (_, index) => Math.max(0, Math.min(1, average * (0.65 + Math.sin(index * 1.7) * 0.25)))));
      frame = window.requestAnimationFrame(update);
    };
    void context.resume();
    update();
    audioCleanupRef.current = () => { window.cancelAnimationFrame(frame); source.disconnect(); analyser.disconnect(); void context.close(); stopStream(stream); };
  }, []);
  const start = async () => {
    if (disabled || recordingRef.current || transcribing) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { onError('Audio recording is not supported by this app environment.'); return; }
    const mimeType = AUDIO_MIME_TYPES.find(value => MediaRecorder.isTypeSupported(value));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, mimeType === undefined ? undefined : { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = event => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorderRef.current = recorder;
      recordingRef.current = true;
      setElapsedSeconds(0);
      setRecording(true);
      startAudio(stream);
      recorder.start();
    } catch (error) {
      stopAudio();
      recordingRef.current = false;
      recorderRef.current = undefined;
      onError(audioErrorMessage(error));
    }
  };
  const stop = () => {
    if (!recordingRef.current || transcribing) return;
    recordingRef.current = false;
    setRecording(false);
    setTranscribing(true);
    const recorder = recorderRef.current;
    void finalizeRecorder(recorder, chunksRef.current).then(async blob => {
      stopAudio();
      recorderRef.current = undefined;
      const result = await window.lotagate.speech.transcribe(await recordingToWav(blob));
      onComplete(result.text);
    }).catch(error => onError(error instanceof Error ? error.message : 'Unable to transcribe the recording.')).finally(() => { setTranscribing(false); chunksRef.current = []; });
  };
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setElapsedSeconds(value => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [recording]);
  useEffect(() => () => { recordingRef.current = false; const recorder = recorderRef.current; if (recorder?.state === 'recording') recorder.stop(); stopAudio(); }, [stopAudio]);
  if (transcribing) return <div className="voice-input voice-input-processing"><IconButton icon={LoaderCircle} iconSize={16} className="voice-processing-button" label="Transcribing recording" disabled /></div>;
  if (!recording) return <IconButton icon={Mic} iconSize={16} className="voice-input-button" label="Start voice input" disabled={disabled} onClick={() => void start()} />;
  return <div className="voice-input voice-input-recording"><div className="voice-wave" aria-label="Recording">{levels.map((level, index) => <span key={index} style={{ height: `${3 + Math.round(level * 17)}px` }} />)}</div><span className="voice-elapsed" aria-live="polite">{formatElapsed(elapsedSeconds)}</span><IconButton icon={Square} iconSize={14} className="voice-stop-button" label="Stop voice input" onClick={stop} /></div>;
}

async function finalizeRecorder(recorder: MediaRecorder | undefined, chunks: Blob[]): Promise<Blob> {
  if (recorder === undefined) throw new Error('Audio recording was not initialized.');
  if (recorder.state === 'inactive') return new Blob(chunks, { type: recorder.mimeType });
  return new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
    recorder.onerror = () => reject(new Error('Audio recording failed.'));
    try { recorder.stop(); } catch (error) { reject(error instanceof Error ? error : new Error('Audio recording could not be stopped.')); }
  });
}

function createSilentLevels(): number[] { return Array.from({ length: 48 }, () => 0); }
function stopStream(stream: MediaStream): void { stream.getTracks().forEach(track => track.stop()); }
function formatElapsed(seconds: number): string { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; }
function audioErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : undefined;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was denied. Enable microphone access for desktop apps in Windows Privacy settings, then try again.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone is available. Connect a microphone and try again.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The microphone is busy or unavailable to this app. Close other apps using it and try again.';
  return `Microphone recording failed${name === undefined ? '' : ` (${name})`}. Check the Windows microphone settings and try again.`;
}
