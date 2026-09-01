import { useState } from 'react';
import { Navigation, Pagination } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import type { Artifact } from '../../../contracts/ipc/v1/workspace.js';
import type { VisualArtifact } from './source-view.js';
import { AudioWaveform } from './SourceAudioList.js';
import { LightBox } from './LightBox.js';
import type { LightBoxMediaItem } from './lightbox-types.js';
import { useArtifactMediaUrls } from './use-artifact-media-url.js';

export function AgentMediaResponse({ taskId, artifacts }: { taskId: string; artifacts: readonly Artifact[] }) {
  const mediaArtifacts = artifacts.filter(isVisualArtifact);
  const audio = artifacts.filter(artifact => artifact.kind === 'audio');
  return <div className="agent-media-response">{mediaArtifacts.length > 0 ? <AgentMediaGallery taskId={taskId} artifacts={mediaArtifacts} /> : null}{audio.map(artifact => <AudioWaveform key={artifact.id} taskId={taskId} artifact={artifact} compact />)}</div>;
}

function AgentMediaGallery({ taskId, artifacts }: { taskId: string; artifacts: readonly VisualArtifact[] }) {
  const mediaUrls = useArtifactMediaUrls(taskId, artifacts);
  const [lightBoxIndex, setLightBoxIndex] = useState<number>();
  const items = artifacts.flatMap<LightBoxMediaItem>(artifact => {
    const loaded = mediaUrls[artifact.id];
    if (loaded?.url === undefined) return [];
    return [{ id: artifact.id, name: artifact.name, src: loaded.url, kind: artifact.kind, downloadName: artifact.name }];
  });
  const itemIndexById = new Map(items.map((item, index) => [item.id, index]));
  const slides = artifacts.map(artifact => <AgentMediaSlide key={artifact.id} artifact={artifact} media={mediaUrls[artifact.id]} onOpen={() => setLightBoxIndex(itemIndexById.get(artifact.id))} />);
  const galleryClassName = `agent-media-gallery${slides.length === 1 ? ' agent-media-gallery-single' : ''}`;
  return <>{slides.length === 1 ? <div className={galleryClassName}>{slides}</div> : <div className={galleryClassName}><Swiper modules={[Navigation, Pagination]} navigation pagination={{ clickable: true }} spaceBetween={12} slidesPerView={1}>{slides.map((slide, index) => <SwiperSlide key={artifacts[index]!.id} className="agent-media-slide">{slide}</SwiperSlide>)}</Swiper></div>}{lightBoxIndex !== undefined ? <LightBox items={items} initialIndex={lightBoxIndex} onClose={() => setLightBoxIndex(undefined)} /> : null}</>;
}

function AgentMediaSlide({ artifact, media, onOpen }: { artifact: VisualArtifact; media: { url?: string; error?: string } | undefined; onOpen: () => void }) {
  if (media?.error) return <p className="agent-media-error">Unable to load {artifact.name}.</p>;
  if (media?.url === undefined) return <div className="agent-media-loading" aria-label={`Loading ${artifact.name}`} />;
  return <button type="button" className="agent-media-open" onClick={onOpen} aria-label={`Open ${artifact.kind} ${artifact.name}`}>{artifact.kind === 'video' ? <video className="agent-media-video" src={media.url} muted playsInline preload="metadata" /> : <img className="agent-media-image" src={media.url} alt={artifact.name} />}</button>;
}

function isVisualArtifact(artifact: Artifact): artifact is VisualArtifact {
  return artifact.kind === 'image' || artifact.kind === 'video';
}
