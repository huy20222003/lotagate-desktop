import { useEffect, useState } from 'react';

export function Avatar({ name, src }: { name?: string; src?: string }) {
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'failed'>(src ? 'loading' : 'failed');
  const initials = (name ?? '?').split(/\s+/u).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  useEffect(() => setImageState(src ? 'loading' : 'failed'), [src]);
  if (!src || imageState === 'failed') return <span className="avatar avatar-fallback" aria-hidden="true">{initials}</span>;
  return <span className="avatar avatar-image-frame"><span className="avatar avatar-fallback" aria-hidden="true">{initials}</span><img className={`avatar avatar-image ${imageState === 'loaded' ? 'loaded' : ''}`} src={src} alt="" onLoad={() => setImageState('loaded')} onError={() => setImageState('failed')} /></span>;
}
