import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { clamp, FILE_PANEL_DEFAULT_WIDTH, FILE_PANEL_MAX_WIDTH, FILE_PANEL_MIN_WIDTH } from './file-change-view.js';

export function useResizableSidePanel() {
  const [panelWidth, setPanelWidth] = useState(FILE_PANEL_DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<{ clientX: number; width: number } | undefined>();

  const resizePanel = useCallback((clientX: number) => {
    const start = resizeStart.current;
    if (!start) return;
    const availableWidth = Math.max(FILE_PANEL_MIN_WIDTH, Math.floor(window.innerWidth * 0.75));
    setPanelWidth(clamp(start.width - (clientX - start.clientX), FILE_PANEL_MIN_WIDTH, Math.min(FILE_PANEL_MAX_WIDTH, availableWidth)));
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const move = (event: PointerEvent) => resizePanel(event.clientX);
    const stop = () => {
      resizeStart.current = undefined;
      setResizing(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
  }, [resizePanel, resizing]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStart.current = { clientX: event.clientX, width: panelWidth };
    setResizing(true);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setPanelWidth(current => clamp(current + (event.key === 'ArrowLeft' ? 16 : -16), FILE_PANEL_MIN_WIDTH, FILE_PANEL_MAX_WIDTH));
  };

  return { panelWidth, resizing, startResize, handleResizeKeyDown };
}
