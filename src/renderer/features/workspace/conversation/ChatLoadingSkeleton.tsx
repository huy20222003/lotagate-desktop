import { Skeleton } from '../../../components/ui.js';

export function ChatLoadingSkeleton() {
  return <div className="chat-loading-skeleton" aria-label="Loading chat"><Skeleton className="skeleton-chat-line skeleton-chat-short" /><Skeleton className="skeleton-chat-line" /><Skeleton className="skeleton-chat-line skeleton-chat-medium" /><Skeleton className="skeleton-chat-block" /></div>;
}
