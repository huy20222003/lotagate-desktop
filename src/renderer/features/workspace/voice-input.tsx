import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

interface SpeechResultEventLike { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechWindow = Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor; mozSpeechRecognition?: SpeechRecognitionConstructor; msSpeechRecognition?: SpeechRecognitionConstructor };

export function VoiceInput({ disabled, onComplete, onError }: { disabled: boolean; onComplete: (transcript: string) => void; onError: (message: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: 48 }, () => 0));
  const [interim, setInterim] = useState('');
  const recognitionRef = useRef<SpeechRecognitionLike | undefined>();
  const recognitionStartedRef = useRef(false);
  const finalTextRef = useRef('');
  const recordingRef = useRef(false);
  const audioCleanupRef = useRef<(() => void) | undefined>();

  const stopAudio = useCallback(() => {
    audioCleanupRef.current?.();
    audioCleanupRef.current = undefined;
    setLevels(Array.from({ length: 48 }, () => 0));
  }, []);
  const finish = useCallback((commit: boolean) => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    setInterim('');
    recognitionRef.current = undefined;
    recognitionStartedRef.current = false;
    stopAudio();
    if (commit) onComplete(finalTextRef.current.trim());
  }, [onComplete, stopAudio]);
  const startAudio = useCallback(async (): Promise<boolean> => {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!recordingRef.current) { stream.getTracks().forEach(track => track.stop()); return false; }
      const AudioContextConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) { stream.getTracks().forEach(track => track.stop()); return true; }
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
      update();
      audioCleanupRef.current = () => { window.cancelAnimationFrame(frame); source.disconnect(); analyser.disconnect(); stream.getTracks().forEach(track => track.stop()); void context.close(); };
      return true;
    } catch (error) {
      const name = error instanceof DOMException ? error.name : undefined;
      onError(microphoneErrorMessage(name));
      return false;
    }
  }, []);
  const start = async () => {
    if (disabled || recordingRef.current) return;
    const Recognition = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition ?? (window as SpeechWindow).mozSpeechRecognition ?? (window as SpeechWindow).msSpeechRecognition;
    if (!Recognition) { onError('Speech recognition is not supported by this app environment.'); return; }
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = event => {
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal) finalTextRef.current += `${result[0]?.transcript ?? ''} `;
        else interimText += result?.[0]?.transcript ?? '';
      }
      setInterim(interimText);
    };
    recognition.onerror = event => {
      if (event.error !== 'aborted') onError(speechErrorMessage(event.error));
      finish(false);
    };
    recognition.onend = () => finish(true);
    finalTextRef.current = '';
    setInterim('');
    recognitionRef.current = recognition;
    recordingRef.current = true;
    setRecording(true);
    const microphoneReady = await startAudio();
    if (!recordingRef.current) return;
    if (!microphoneReady) {
      finish(false);
      return;
    }
    try { recognition.start(); recognitionStartedRef.current = true; } catch { finish(false); onError('Speech recognition could not be started.'); }
  };
  const stop = () => {
    if (!recordingRef.current) return;
    if (recognitionStartedRef.current) recognitionRef.current?.stop();
    else finish(false);
  };
  useEffect(() => () => { recognitionRef.current?.abort?.(); recordingRef.current = false; stopAudio(); }, [stopAudio]);
  return recording ? <div className="voice-input voice-input-recording"><div className="voice-wave" aria-label="Recording"><span className="voice-wave-line" />{levels.map((level, index) => <span key={index} style={{ height: `${3 + Math.round(level * 17)}px` }} />)}<span className="voice-wave-line" /></div>{interim ? <span className="voice-interim" aria-live="polite">{interim}</span> : null}<button type="button" className="icon-button voice-stop-button" aria-label="Stop voice input" onClick={stop}><Square size={14} fill="currentColor" /></button></div> : <button type="button" className="icon-button voice-input-button" aria-label="Start voice input" disabled={disabled} onClick={start}><Mic size={16} /></button>;
}

function microphoneErrorMessage(error: string | undefined): string {
  if (error === 'NotAllowedError' || error === 'SecurityError') return 'Microphone access was denied. Enable microphone access for desktop apps in Windows Privacy settings, then try again.';
  if (error === 'NotFoundError' || error === 'DevicesNotFoundError') return 'No microphone is available. Connect a microphone and try again.';
  if (error === 'NotReadableError' || error === 'TrackStartError') return 'The microphone is busy or unavailable to this app. Close other apps using it and try again.';
  return `Microphone access failed${error ? ` (${error})` : ''}. Check the Windows microphone settings and try again.`;
}

function speechErrorMessage(error: string | undefined): string {
  if (error === 'not-allowed') return 'Microphone access was denied. Enable microphone access for desktop apps in Windows Privacy settings, then try again.';
  if (error === 'audio-capture') return 'No microphone is available. Connect a microphone and try again.';
  if (error === 'network') return 'Speech recognition service is unavailable in this Electron app. Microphone access is available, but the browser speech service could not connect.';
  if (error === 'service-not-allowed') return 'Speech recognition service is not available in this Electron app.';
  return `Speech recognition failed${error ? ` (${error})` : ''}.`;
}
