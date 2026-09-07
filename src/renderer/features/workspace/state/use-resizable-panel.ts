import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { clamp, FILE_PANEL_DEFAULT_WIDTH, FILE_PANEL_MAX_WIDTH, FILE_PANEL_MIN_WIDTH } from '../review/file-change-view.js';

type ResizeSide = 'left' | 'right';
interface ResizableSidePanelOptions { side?: ResizeSide; initialWidth?: number; minWidth?: number; maxWidth?: number }

export function useResizableSidePanel({ side = 'right', initialWidth = FILE_PANEL_DEFAULT_WIDTH, minWidth = FILE_PANEL_MIN_WIDTH, maxWidth = FILE_PANEL_MAX_WIDTH }: ResizableSidePanelOptions = {}) {
  const [panelWidth, setPanelWidth] = useState(initialWidth);
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<{ clientX: number; width: number } | undefined>();

  const resizePanel = useCallback((clientX: number) => {
    const start = resizeStart.current;
    if (!start) return;
    const availableWidth = Math.max(minWidth, Math.floor(window.innerWidth * 0.75));
    const delta = clientX - start.clientX;
    const nextWidth = side === 'left' ? start.width + delta : start.width - delta;
    setPanelWidth(clamp(nextWidth, minWidth, Math.min(maxWidth, availableWidth)));
  }, [maxWidth, minWidth, side]);

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
    const grows = side === 'left' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft';
    setPanelWidth(current => clamp(current + (grows ? 16 : -16), minWidth, maxWidth));
  };

  return { panelWidth, resizing, startResize, handleResizeKeyDown };
}

interface ResizableBottomPanelOptions { initialHeight?: number; minHeight?: number; maxHeight?: number }

export function useResizableBottomPanel({ initialHeight = 320, minHeight = 180, maxHeight = 720 }: ResizableBottomPanelOptions = {}) {
  const [panelHeight, setPanelHeight] = useState(initialHeight);
  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef<{ clientY: number; height: number } | undefined>();

  const resizePanel = useCallback((clientY: number) => {
    const start = resizeStart.current;
    if (!start) return;
    const availableHeight = Math.max(minHeight, Math.floor(window.innerHeight * 0.75));
    const delta = clientY - start.clientY;
    setPanelHeight(clamp(start.height - delta, minHeight, Math.min(maxHeight, availableHeight)));
  }, [maxHeight, minHeight]);

  useEffect(() => {
    if (!resizing) return;
    const move = (event: PointerEvent) => resizePanel(event.clientY);
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
    resizeStart.current = { clientY: event.clientY, height: panelHeight };
    setResizing(true);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    setPanelHeight(current => clamp(current + (event.key === 'ArrowUp' ? 16 : -16), minHeight, maxHeight));
  };

  return { panelHeight, resizing, startResize, handleResizeKeyDown };
}
