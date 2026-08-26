import { X } from 'lucide-react';

export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return <div className="image-lightbox" role="presentation" onClick={onClose}><section className="image-lightbox-content" role="dialog" aria-modal="true" aria-label={alt} onClick={event => event.stopPropagation()}><button type="button" className="image-lightbox-close" aria-label="Close image preview" onClick={onClose}><X size={20} /></button><img src={src} alt={alt} /></section></div>;
}
