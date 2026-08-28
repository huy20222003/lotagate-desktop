import { useCallback, useEffect, useRef, useState, type MutableRefObject, type PropsWithChildren } from 'react';

type ScrollbarAxis = 'vertical' | 'horizontal' | 'both';

export function Scrollbar({ children, className = '', viewportRef: externalViewportRef, axis = 'vertical' }: PropsWithChildren<{ className?: string; viewportRef?: MutableRefObject<HTMLDivElement | null>; axis?: ScrollbarAxis }>) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState({ vertical: { size: 0, offset: 0, visible: false }, horizontal: { size: 0, offset: 0, visible: false } });
  const setViewportRef = useCallback((node: HTMLDivElement | null) => { viewportRef.current = node; if (externalViewportRef) externalViewportRef.current = node; }, [externalViewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const calculate = (viewportSize: number, contentSize: number, scrollOffset: number) => {
        const visible = contentSize > viewportSize;
        const size = visible ? Math.max(28, (viewportSize / contentSize) * viewportSize) : 0;
        const range = viewportSize - size;
        const offset = range > 0 ? (scrollOffset / (contentSize - viewportSize)) * range : 0;
        return { size, offset, visible };
      };
      setThumb({ vertical: axis === 'horizontal' ? { size: 0, offset: 0, visible: false } : calculate(viewport.clientHeight, viewport.scrollHeight, viewport.scrollTop), horizontal: axis === 'vertical' ? { size: 0, offset: 0, visible: false } : calculate(viewport.clientWidth, viewport.scrollWidth, viewport.scrollLeft) });
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
    {thumb.vertical.visible ? <div className="scrollbar-track" aria-hidden="true"><span className="scrollbar-thumb" style={{ height: thumb.vertical.size, transform: `translateY(${thumb.vertical.offset}px)` }} /></div> : null}
    {thumb.horizontal.visible ? <div className="scrollbar-track scrollbar-track-horizontal" aria-hidden="true"><span className="scrollbar-thumb" style={{ width: thumb.horizontal.size, transform: `translateX(${thumb.horizontal.offset}px)` }} /></div> : null}
  </div>;
}
