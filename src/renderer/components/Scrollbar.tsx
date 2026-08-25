import { useCallback, useEffect, useRef, useState, type MutableRefObject, type PropsWithChildren } from 'react';

export function Scrollbar({ children, className = '', viewportRef: externalViewportRef }: PropsWithChildren<{ className?: string; viewportRef?: MutableRefObject<HTMLDivElement | null> }>) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState({ height: 0, top: 0, visible: false });
  const setViewportRef = useCallback((node: HTMLDivElement | null) => { viewportRef.current = node; if (externalViewportRef) externalViewportRef.current = node; }, [externalViewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const overflow = viewport.scrollHeight > viewport.clientHeight;
      const height = overflow ? Math.max(28, (viewport.clientHeight / viewport.scrollHeight) * viewport.clientHeight) : 0;
      const range = viewport.clientHeight - height;
      const top = range > 0 ? (viewport.scrollTop / (viewport.scrollHeight - viewport.clientHeight)) * range : 0;
      setThumb({ height, top, visible: overflow });
    };
    update();
    viewport.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => { viewport.removeEventListener('scroll', update); observer.disconnect(); };
  }, []);

  return <div className={`scrollbar ${className}`}>
    <div ref={setViewportRef} className="scrollbar-viewport">{children}</div>
    {thumb.visible ? <div className="scrollbar-track" aria-hidden="true"><span className="scrollbar-thumb" style={{ height: thumb.height, transform: `translateY(${thumb.top}px)` }} /></div> : null}
  </div>;
}
