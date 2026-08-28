import { useState } from 'react';
import { Navigation, Pagination } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';
import type { Artifact } from '../../../contracts/ipc/v1/workspace.js';
import { AudioWaveform } from './SourceAudioList.js';
import { ImageLightbox } from './ImageLightbox.js';
import { useArtifactMediaUrl } from './use-artifact-media-url.js';

export function AgentMediaResponse({ taskId, artifacts }: { taskId: string; artifacts: readonly Artifact[] }) {
  const images = artifacts.filter(artifact => artifact.kind === 'image');
  const videos = artifacts.filter(artifact => artifact.kind === 'video');
  const audio = artifacts.filter(artifact => artifact.kind === 'audio');
  return <div className="agent-media-response">
    {images.length > 0 ? <AgentImageGallery taskId={taskId} artifacts={images} /> : null}
    {videos.map(artifact => <AgentVideo key={artifact.id} taskId={taskId} artifact={artifact} />)}
    {audio.map(artifact => <AudioWaveform key={artifact.id} taskId={taskId} artifact={artifact} compact />)}
  </div>;
}

function AgentImageGallery({ taskId, artifacts }: { taskId: string; artifacts: readonly Artifact[] }) {
  const slides = artifacts.map(artifact => <AgentImage key={artifact.id} taskId={taskId} artifact={artifact} />);
  const galleryClassName = `agent-media-gallery${slides.length === 1 ? ' agent-media-gallery-single' : ''}`;
  if (slides.length === 1) return <div className={galleryClassName}>{slides}</div>;
  return <div className={galleryClassName}><Swiper modules={[Navigation, Pagination]} navigation pagination={{ clickable: true }} spaceBetween={12} slidesPerView={1}>{slides.map((slide, index) => <SwiperSlide key={artifacts[index]!.id} className="agent-media-slide">{slide}</SwiperSlide>)}</Swiper></div>;
}

function AgentImage({ taskId, artifact }: { taskId: string; artifact: Artifact }) {
  const { url, error } = useArtifactMediaUrl(taskId, artifact);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  if (error) return <p className="agent-media-error">Unable to load {artifact.name}.</p>;
  if (!url) return <div className="agent-media-loading" aria-label={`Loading ${artifact.name}`} />;
  return <><button type="button" className="agent-media-image-button" onClick={() => setLightboxOpen(true)} aria-label={`Open ${artifact.name}`}><img className="agent-media-image" src={url} alt={artifact.name} /></button>{lightboxOpen ? <ImageLightbox src={url} alt={artifact.name} downloadName={artifact.name} onClose={() => setLightboxOpen(false)} /> : null}</>;
}

function AgentVideo({ taskId, artifact }: { taskId: string; artifact: Artifact }) {
  const { url, error } = useArtifactMediaUrl(taskId, artifact);
  if (error) return <p className="agent-media-error">Unable to load {artifact.name}.</p>;
  return url ? <video className="agent-media-video" src={url} controls preload="metadata" /> : <div className="agent-media-loading" aria-label={`Loading ${artifact.name}`} />;
}
