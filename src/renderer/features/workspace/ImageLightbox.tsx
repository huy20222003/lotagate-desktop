import { Download, X } from 'lucide-react';
import { Icon, IconButton, OverlayDialog, Tooltip } from '../../components/ui.js';

export function ImageLightbox({ src, alt, downloadName, onClose }: { src: string; alt: string; downloadName?: string; onClose: () => void }) {
  const actions = <div className="image-lightbox-actions" onClick={event => event.stopPropagation()}>{downloadName ? <Tooltip label={`Download ${downloadName}`}><a className="image-lightbox-action" href={src} download={downloadName} aria-label={`Download ${downloadName}`}><Icon icon={Download} size={18} /></a></Tooltip> : null}<IconButton icon={X} iconSize={20} className="image-lightbox-action" label="Close image preview" onClick={onClose} /></div>;
  return <OverlayDialog label={alt} onClose={onClose} className="image-lightbox-content" overlayClassName="image-lightbox"><div className="image-lightbox-stage" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>{actions}<img src={src} alt={alt} onClick={event => event.stopPropagation()} /></div></OverlayDialog>;
}
