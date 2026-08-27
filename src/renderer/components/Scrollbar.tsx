import { useCallback, useEffect, useRef, useState, type MutableRefObject, type PropsWithChildren } from 'react';

type ScrollbarAxis = 'vertical' | 'horizontal';

export function Scrollbar({ children, className = '', viewportRef: externalViewportRef, axis = 'vertical' }: PropsWithChildren<{ className?: string; viewportRef?: MutableRefObject<HTMLDivElement | null>; axis?: ScrollbarAxis }>) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState({ size: 0, offset: 0, visible: false });
  const setViewportRef = useCallback((node: HTMLDivElement | null) => { viewportRef.current = node; if (externalViewportRef) externalViewportRef.current = node; }, [externalViewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const viewportSize = axis === 'horizontal' ? viewport.clientWidth : viewport.clientHeight;
      const contentSize = axis === 'horizontal' ? viewport.scrollWidth : viewport.scrollHeight;
      const scrollOffset = axis === 'horizontal' ? viewport.scrollLeft : viewport.scrollTop;
      const overflow = contentSize > viewportSize;
      const size = overflow ? Math.max(28, (viewportSize / contentSize) * viewportSize) : 0;
      const range = viewportSize - size;
      const offset = range > 0 ? (scrollOffset / (contentSize - viewportSize)) * range : 0;
      setThumb({ size, offset, visible: overflow });
    };
    update();
    viewport.addEventListener('scroll', update, { passive: true });
    if (typeof ResizeObserver === 'undefined') return () => viewport.removeEventListener('scroll', update);
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => { viewport.removeEventListener('scroll', update); observer.disconnect(); };
  }, [axis]);

  return <div className={`scrollbar scrollbar-thin ${className}`}>
    <div ref={setViewportRef} className="scrollbar-viewport">{children}</div>
    {thumb.visible ? <div className={`scrollbar-track${axis === 'horizontal' ? ' scrollbar-track-horizontal' : ''}`} aria-hidden="true"><span className="scrollbar-thumb" style={axis === 'horizontal' ? { width: thumb.size, transform: `translateX(${thumb.offset}px)` } : { height: thumb.size, transform: `translateY(${thumb.offset}px)` }} /></div> : null}
  </div>;
}
