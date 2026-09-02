import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Activity } from '../../../../contracts/ipc/v1/workspace.js';
import { formatTextClamp } from '../../../utils/text.js';
import { mergeChatActivities } from './conversation-activities.js';

const TIMELINE_MARKER_MIN_GAP = 14;
const TIMELINE_MARKER_MAX_GAP = 18;
const TIMELINE_TRACK_PADDING = 14;
const TIMELINE_USER_PREVIEW_CHARACTERS = 60;
const TIMELINE_AGENT_PREVIEW_CHARACTERS = 96;

interface TimelineMessage {
  activity: Activity;
  responseText?: string;
}

function buildTimelineMessages(activities: Activity[]): TimelineMessage[] {
  const transcript = mergeChatActivities(activities);
  return transcript.flatMap((activity, index) => {
    if (activity.kind !== 'user') return [];
    const nextUserIndex = transcript.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.kind === 'user');
    const response = transcript.slice(index + 1, nextUserIndex < 0 ? transcript.length : nextUserIndex).find(candidate => candidate.kind === 'assistant' || candidate.kind === 'error');
    const responseText = response?.text.trim();
    return [{ activity, ...(responseText ? { responseText } : {}) }];
  });
}

function initialTimelineHeight(): number {
  if (typeof window === 'undefined') return 0;
  return Math.max(220, Math.min(window.innerHeight * 0.72, 720));
}

export function ConversationTimeline({ activities, onSelect, viewportRef }: { activities: Activity[]; onSelect: (activityId: string) => void; viewportRef: RefObject<HTMLDivElement | null> }) {
  const timelineMessages = useMemo(() => buildTimelineMessages(activities), [activities]);
  const userMessages = useMemo(() => timelineMessages.map(message => message.activity), [timelineMessages]);
  const [activeActivityId, setActiveActivityId] = useState<string | undefined>(userMessages[0]?.id);
  const [timelineHeight, setTimelineHeight] = useState(initialTimelineHeight);
  const [scrollState, setScrollState] = useState({ canScrollUp: false, canScrollDown: false });
  const [timelineScrollTop, setTimelineScrollTop] = useState(0);
  const [hoveredActivityId, setHoveredActivityId] = useState<string | undefined>();
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
    setTimelineScrollTop(timelineViewport.scrollTop);
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
    const updateHeight = () => {
      if (timelineViewport.clientHeight > 0) setTimelineHeight(timelineViewport.clientHeight);
    };
    updateHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(timelineViewport);
    return () => observer.disconnect();
  }, []);

  const markerGap = userMessages.length <= 1 ? 0 : Math.max(TIMELINE_MARKER_MIN_GAP, Math.min(TIMELINE_MARKER_MAX_GAP, (timelineHeight - TIMELINE_TRACK_PADDING * 2) / (userMessages.length - 1)));
  const timelineContentHeight = TIMELINE_TRACK_PADDING * 2 + Math.max(0, userMessages.length - 1) * markerGap;
  const trackHeight = Math.max(timelineHeight, timelineContentHeight);
  const markerOffset = Math.max(0, (timelineHeight - timelineContentHeight) / 2);
  const activeIndex = userMessages.findIndex(activity => activity.id === activeActivityId);
  const hoveredMessage = timelineMessages.find(message => message.activity.id === hoveredActivityId);
  const hoveredIndex = hoveredActivityId === undefined ? -1 : userMessages.findIndex(activity => activity.id === hoveredActivityId);
  const hoveredPopoverTop = hoveredIndex < 0 ? undefined : markerOffset + TIMELINE_TRACK_PADDING + hoveredIndex * markerGap - timelineScrollTop;
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
    const markerTop = markerOffset + TIMELINE_TRACK_PADDING + activeIndex * markerGap;
    const targetScrollTop = markerTop - timelineHeight / 2;
    timelineViewport.scrollTo({ top: Math.max(0, Math.min(targetScrollTop, trackHeight - timelineHeight)), behavior: 'smooth' });
  }, [activeIndex, markerGap, markerOffset, timelineHeight, trackHeight]);

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
  return <aside className="conversation-timeline" aria-label="User messages"><div className={`conversation-timeline-window${scrollState.canScrollUp ? ' has-overflow-above' : ''}${scrollState.canScrollDown ? ' has-overflow-below' : ''}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopPointerDrag} onPointerCancel={stopPointerDrag}><div ref={timelineViewportRef} className="conversation-timeline-scroll" onScroll={updateScrollState}><div className="conversation-timeline-list" style={{ height: `${trackHeight}px` }}>{userMessages.map((activity, index) => { const position = markerOffset + (userMessages.length === 1 ? TIMELINE_TRACK_PADDING : TIMELINE_TRACK_PADDING + index * markerGap); return <button type="button" key={activity.id} className={`conversation-timeline-marker ${activeActivityId === activity.id ? 'active' : ''}`} style={{ top: `${position}px` }} aria-current={activeActivityId === activity.id ? 'location' : undefined} aria-label={`Jump to message: ${formatTextClamp(80, activity.text)}`} onMouseEnter={() => setHoveredActivityId(activity.id)} onMouseLeave={() => setHoveredActivityId(undefined)} onFocus={() => setHoveredActivityId(activity.id)} onBlur={() => setHoveredActivityId(undefined)} onClick={() => onSelect(activity.id)}><span /></button>; })}</div></div>{hoveredMessage && hoveredPopoverTop !== undefined ? <div className="conversation-timeline-popover" style={{ top: `${hoveredPopoverTop}px` }}><span className="conversation-timeline-preview-user">{formatTextClamp(TIMELINE_USER_PREVIEW_CHARACTERS, hoveredMessage.activity.text)}</span>{hoveredMessage.responseText ? <span className="conversation-timeline-preview-agent">{formatTextClamp(TIMELINE_AGENT_PREVIEW_CHARACTERS, hoveredMessage.responseText)}</span> : null}</div> : null}<span className="conversation-timeline-fade conversation-timeline-fade-top" aria-hidden="true" /><span className="conversation-timeline-fade conversation-timeline-fade-bottom" aria-hidden="true" /></div></aside>;
}
