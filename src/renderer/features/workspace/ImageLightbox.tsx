import { Download, X } from 'lucide-react';

export function ImageLightbox({ src, alt, downloadName, onClose }: { src: string; alt: string; downloadName?: string; onClose: () => void }) {
  return <div className="image-lightbox" role="presentation" onClick={onClose}><section className="image-lightbox-content" role="dialog" aria-modal="true" aria-label={alt} onClick={event => event.stopPropagation()}><div className="image-lightbox-actions">{downloadName ? <a className="image-lightbox-action" href={src} download={downloadName} aria-label={`Download ${downloadName}`}><Download size={18} /></a> : null}<button type="button" className="image-lightbox-action" aria-label="Close image preview" onClick={onClose}><X size={20} /></button></div><img src={src} alt={alt} /></section></div>;
}
