import WaveSurfer from 'wavesurfer.js';
import { Download, Pause, Play, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Artifact } from '../../../contracts/ipc/v1/workspace.js';
import { IconButton } from '../../components/ui.js';
import { artifactMediaBlob, formatArtifactSize } from './source-view.js';

export function SourceAudioList({ taskId, artifacts, onPreview, onDownload }: { taskId: string; artifacts: readonly Artifact[]; onPreview: (artifact: Artifact) => void; onDownload: (artifact: Artifact) => void }) {
  if (artifacts.length === 0) return <p className="source-empty">No audio files in this session.</p>;
  return <div className="source-audio-list">{artifacts.map(artifact => <AudioArtifactRow key={artifact.id} taskId={taskId} artifact={artifact} onPreview={onPreview} onDownload={onDownload} />)}</div>;
}

export function AudioWaveform({ taskId, artifact, sourceUrl, compact = false, onDownload }: { taskId: string; artifact: Artifact; sourceUrl?: string; compact?: boolean; onDownload?: (artifact: Artifact) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<WaveSurfer | undefined>(undefined);
  const [url, setUrl] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    if (sourceUrl !== undefined) { setUrl(sourceUrl); setError(undefined); return; }
    setUrl(undefined);
    setError(undefined);
    void window.lotagate.tasks.readArtifactMedia(taskId, artifact.id).then(media => {
      if (cancelled) return;
      setUrl(URL.createObjectURL(artifactMediaBlob(media.bytes, media.mimeType)));
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load audio.'); });
    return () => { cancelled = true; };
  }, [artifact.id, sourceUrl, taskId]);

  useEffect(() => {
    if (!url || !containerRef.current) return;
    const wave = WaveSurfer.create({ container: containerRef.current, url, backend: 'MediaElement', height: compact ? 34 : 72, barWidth: compact ? 2 : 3, barGap: compact ? 1 : 2, barRadius: 3, waveColor: 'var(--color-border-focus)', progressColor: 'var(--color-accent)', cursorColor: 'var(--color-text-link)', normalize: true });
    waveRef.current = wave;
    wave.on('ready', length => setDuration(length));
    wave.on('timeupdate', time => setCurrentTime(time));
    wave.on('play', () => setPlaying(true));
    wave.on('pause', () => setPlaying(false));
    wave.on('finish', () => { setPlaying(false); setCurrentTime(0); });
    wave.on('error', reason => setError(String(reason)));
    const ownsUrl = sourceUrl === undefined;
    return () => { wave.destroy(); waveRef.current = undefined; if (ownsUrl) URL.revokeObjectURL(url); };
  }, [compact, url]);

  if (error) return <p className="source-audio-error">{error}</p>;
  return <div className={`source-audio-waveform${compact ? ' compact' : ''}`}><IconButton icon={playing ? Pause : Play} iconSize={compact ? 14 : 17} className="source-audio-play" label={playing ? `Pause ${artifact.name}` : `Play ${artifact.name}`} disabled={!url} onClick={() => void waveRef.current?.playPause()} /><div className="source-audio-wave" ref={containerRef} /><div className="source-audio-time">{formatTime(currentTime)} / {formatTime(duration)}</div>{onDownload ? <IconButton icon={Download} iconSize={14} className="source-audio-download" label={`Download ${artifact.name}`} onClick={() => onDownload(artifact)} /> : null}</div>;
}

function AudioArtifactRow({ taskId, artifact, onPreview, onDownload }: { taskId: string; artifact: Artifact; onPreview: (artifact: Artifact) => void; onDownload: (artifact: Artifact) => void }) {
  return <article className="source-audio-row"><div className="source-audio-row-heading"><Volume2 size={16} /><button type="button" className="source-artifact-name" onClick={() => onPreview(artifact)} title={artifact.name}>{artifact.name}</button><small>{formatArtifactSize(artifact.size)}</small></div><AudioWaveform taskId={taskId} artifact={artifact} onDownload={onDownload} /></article>;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
