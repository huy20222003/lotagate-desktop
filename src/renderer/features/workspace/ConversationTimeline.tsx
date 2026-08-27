import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { Activity } from '../../../contracts/ipc/v1/workspace.js';
import { formatTextClamp } from '../../utils/text.js';

export function ConversationTimeline({ activities, onSelect, viewportRef }: { activities: Activity[]; onSelect: (activityId: string) => void; viewportRef: RefObject<HTMLDivElement | null> }) {
  const userMessages = useMemo(() => activities.filter(activity => activity.kind === 'user'), [activities]);
  const [activeActivityId, setActiveActivityId] = useState<string | undefined>(userMessages[0]?.id);
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
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    updateActiveMessage();
    viewport.addEventListener('scroll', updateActiveMessage, { passive: true });
    window.addEventListener('resize', updateActiveMessage);
    return () => { viewport.removeEventListener('scroll', updateActiveMessage); window.removeEventListener('resize', updateActiveMessage); };
  }, [updateActiveMessage, viewportRef]);
  if (userMessages.length === 0) return null;
  return <aside className="conversation-timeline" aria-label="User messages" onWheel={event => { viewportRef.current?.scrollBy({ top: event.deltaY, left: 0 }); }}><div className="conversation-timeline-list">{userMessages.map((activity, index) => { const position = userMessages.length === 1 ? 0 : (index / (userMessages.length - 1)) * 100; return <button type="button" key={activity.id} className={`conversation-timeline-marker ${activeActivityId === activity.id ? 'active' : ''}`} style={{ top: `${position}%` }} aria-current={activeActivityId === activity.id ? 'location' : undefined} aria-label={`Jump to message: ${formatTextClamp(80, activity.text)}`} onClick={() => onSelect(activity.id)}><span /><span className="conversation-timeline-popover">{formatTextClamp(120, activity.text)}</span></button>; })}</div></aside>;
}
