import { formatConversationTimeSeparator } from '../../../utils/time.js';

export function ConversationTimeSeparator({ timestamp }: { timestamp: string }) {
  return <div className="conversation-time-separator" role="separator"><time dateTime={timestamp}>{formatConversationTimeSeparator(timestamp)}</time></div>;
}
