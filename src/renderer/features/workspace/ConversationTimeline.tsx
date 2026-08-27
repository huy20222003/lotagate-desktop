import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
import { formatTextClamp } from '../../utils/text.js';

const TIMELINE_MARKER_MIN_GAP = 14;
const TIMELINE_MARKER_MAX_GAP = 28;
const TIMELINE_TRACK_PADDING = 14;

export function ConversationTimeline({ activities, onSelect, viewportRef }: { activities: Activity[]; onSelect: (activityId: string) => void; viewportRef: RefObject<HTMLDivElement | null> }) {
  const userMessages = useMemo(() => activities.filter(activity => activity.kind === 'user'), [activities]);
  const [activeActivityId, setActiveActivityId] = useState<string | undefined>(userMessages[0]?.id);
  const [timelineHeight, setTimelineHeight] = useState(0);
  const [scrollState, setScrollState] = useState({ canScrollUp: false, canScrollDown: false });
  const timelineViewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startScrollTop: number } | undefined>(undefined);
  const previousLastMessageIdRef = useRef<string | undefined>();
  const followLatestRef = useRef(false);

  const updateActiveMessage = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || userMessages.length === 0) return;
    const top = viewport.getBoundingClientRect().top;
    const closest = userMessages.reduce<{ id: string; distance: number } | undefined>((current, activity) => {
      const element = document.getElementById(`chat-message-${activity.id}`);
      if (!element) return current;
      const distance = Math.abs(element.getBoundingClientRect().top - top);
      return current === undefined || distance < current.distance ? { id: activity.id, distance } : current;
    }, undefined);
    if (closest) setActiveActivityId(closest.id);
  }, [userMessages, viewportRef]);

  const updateScrollState = useCallback(() => {
    const timelineViewport = timelineViewportRef.current;
    if (!timelineViewport) return;
    setScrollState({ canScrollUp: timelineViewport.scrollTop > 1, canScrollDown: timelineViewport.scrollTop + timelineViewport.clientHeight < timelineViewport.scrollHeight - 1 });
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    updateActiveMessage();
    viewport.addEventListener('scroll', updateActiveMessage, { passive: true });
    window.addEventListener('resize', updateActiveMessage);
    return () => { viewport.removeEventListener('scroll', updateActiveMessage); window.removeEventListener('resize', updateActiveMessage); };
  }, [updateActiveMessage, viewportRef]);

  useLayoutEffect(() => {
    const timelineViewport = timelineViewportRef.current;
    if (!timelineViewport) return;
    const updateHeight = () => setTimelineHeight(timelineViewport.clientHeight);
    updateHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(timelineViewport);
    return () => observer.disconnect();
  }, []);

  const markerGap = userMessages.length <= 1 ? 0 : Math.max(TIMELINE_MARKER_MIN_GAP, Math.min(TIMELINE_MARKER_MAX_GAP, (timelineHeight - TIMELINE_TRACK_PADDING * 2) / (userMessages.length - 1)));
  const trackHeight = Math.max(timelineHeight, TIMELINE_TRACK_PADDING * 2 + Math.max(0, userMessages.length - 1) * markerGap);
  const activeIndex = userMessages.findIndex(activity => activity.id === activeActivityId);
  const lastUserMessageId = userMessages[userMessages.length - 1]?.id;
  useEffect(() => {
    if (lastUserMessageId === undefined) {
      previousLastMessageIdRef.current = undefined;
      return;
    }
    if (previousLastMessageIdRef.current === lastUserMessageId) return;
    previousLastMessageIdRef.current = lastUserMessageId;
    followLatestRef.current = true;
    setActiveActivityId(lastUserMessageId);
  }, [lastUserMessageId]);

  useEffect(() => {
    const timelineViewport = timelineViewportRef.current;
    if (!timelineViewport || activeIndex < 0 || timelineHeight === 0 || trackHeight <= timelineHeight) return;
    if (followLatestRef.current) {
      followLatestRef.current = false;
      timelineViewport.scrollTo({ top: trackHeight - timelineHeight, behavior: 'auto' });
      return;
    }
    const markerTop = TIMELINE_TRACK_PADDING + activeIndex * markerGap;
    const targetScrollTop = markerTop - timelineHeight / 2;
    timelineViewport.scrollTo({ top: Math.max(0, Math.min(targetScrollTop, trackHeight - timelineHeight)), behavior: 'smooth' });
  }, [activeIndex, markerGap, timelineHeight, trackHeight]);

  useEffect(() => { updateScrollState(); }, [trackHeight, updateScrollState]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLButtonElement) return;
    const timelineViewport = timelineViewportRef.current;
    if (!timelineViewport) return;
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startScrollTop: timelineViewport.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const timelineViewport = timelineViewportRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !timelineViewport) return;
    timelineViewport.scrollTop = drag.startScrollTop - (event.clientY - drag.startY);
  };
  const stopPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => { if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined; };

  if (userMessages.length === 0) return null;
  return <aside className="conversation-timeline" aria-label="User messages"><div className={`conversation-timeline-window${scrollState.canScrollUp ? ' has-overflow-above' : ''}${scrollState.canScrollDown ? ' has-overflow-below' : ''}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopPointerDrag} onPointerCancel={stopPointerDrag}><div ref={timelineViewportRef} className="conversation-timeline-scroll" onScroll={updateScrollState}><div className="conversation-timeline-list" style={{ height: `${trackHeight}px` }}>{userMessages.map((activity, index) => { const position = userMessages.length === 1 ? TIMELINE_TRACK_PADDING : TIMELINE_TRACK_PADDING + index * markerGap; return <button type="button" key={activity.id} className={`conversation-timeline-marker ${activeActivityId === activity.id ? 'active' : ''}`} style={{ top: `${position}px` }} aria-current={activeActivityId === activity.id ? 'location' : undefined} aria-label={`Jump to message: ${formatTextClamp(80, activity.text)}`} onClick={() => onSelect(activity.id)}><span /><span className="conversation-timeline-popover">{formatTextClamp(120, activity.text)}</span></button>; })}</div></div><span className="conversation-timeline-fade conversation-timeline-fade-top" aria-hidden="true" /><span className="conversation-timeline-fade conversation-timeline-fade-bottom" aria-hidden="true" /></div></aside>;
}
