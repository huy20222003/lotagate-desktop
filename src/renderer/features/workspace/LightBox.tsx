import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Keyboard } from 'swiper/modules';
import { Swiper, SwiperSlide } from 'swiper/react';
import type { Swiper as SwiperInstance } from 'swiper';
import 'swiper/css';
import type { LightBoxMediaItem } from './lightbox-types.js';
import { Icon, IconButton, OverlayDialog, Tooltip } from '../../components/ui.js';

export function LightBox({ items, initialIndex = 0, onClose }: { items: readonly LightBoxMediaItem[]; initialIndex?: number; onClose: () => void }) {
  const [activeIndex, setActiveIndex] = useState(Math.min(Math.max(initialIndex, 0), Math.max(items.length - 1, 0)));
  const swiperRef = useRef<SwiperInstance>();
  const activeItem = items[activeIndex];
  if (activeItem === undefined) return null;
  const actions = <div className="lightbox-actions" onClick={event => event.stopPropagation()}>{activeItem.onDownload ? <Tooltip label={`Download ${activeItem.name}`}><IconButton icon={Download} iconSize={18} className="lightbox-action" label={`Download ${activeItem.name}`} onClick={activeItem.onDownload} /></Tooltip> : activeItem.downloadName ? <Tooltip label={`Download ${activeItem.downloadName}`}><a className="lightbox-action" href={activeItem.src} download={activeItem.downloadName} aria-label={`Download ${activeItem.downloadName}`}><Icon icon={Download} size={18} /></a></Tooltip> : null}<IconButton icon={X} iconSize={20} className="lightbox-action" label="Close media preview" onClick={onClose} /></div>;
  return <OverlayDialog label={activeItem.name} onClose={onClose} className="lightbox-content" overlayClassName="lightbox"><div className="lightbox-stage" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>{actions}<Swiper className="lightbox-swiper" modules={[Keyboard]} initialSlide={activeIndex} keyboard={{ enabled: true }} onSwiper={swiper => { swiperRef.current = swiper; }} onSlideChange={swiper => setActiveIndex(swiper.activeIndex)}>{items.map(item => <SwiperSlide key={item.id} className="lightbox-slide"><MediaPreview item={item} /></SwiperSlide>)}</Swiper>{items.length > 1 ? <><IconButton icon={ChevronLeft} iconSize={24} className="lightbox-navigation lightbox-navigation-previous" label="Previous media" disabled={activeIndex <= 0} onClick={() => swiperRef.current?.slidePrev()} /><IconButton icon={ChevronRight} iconSize={24} className="lightbox-navigation lightbox-navigation-next" label="Next media" disabled={activeIndex >= items.length - 1} onClick={() => swiperRef.current?.slideNext()} /></> : null}</div></OverlayDialog>;
}

function MediaPreview({ item }: { item: LightBoxMediaItem }) {
  if (item.kind === 'video') return <video className="lightbox-media lightbox-video" src={item.src} controls autoPlay playsInline preload="metadata" onClick={event => event.stopPropagation()} />;
  return <img className="lightbox-media lightbox-image" src={item.src} alt={item.name} onClick={event => event.stopPropagation()} />;
}
