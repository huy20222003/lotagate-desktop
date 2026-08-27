import { useEffect, useRef, useState } from 'react';

export function SessionTitle({ title }: { title: string }) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setOverflowing(viewport.scrollWidth > viewport.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [title]);
  return <span ref={viewportRef} className={`session-title-viewport ${overflowing ? 'is-overflowing' : ''}`}><span className="session-title-track"><span>{title}</span>{overflowing ? <span aria-hidden="true">{title}</span> : null}</span></span>;
}
